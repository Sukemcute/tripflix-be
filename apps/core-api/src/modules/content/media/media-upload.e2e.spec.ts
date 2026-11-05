import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../../platform/env.js';
import { applyGlobalPrefix } from '../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../platform/tokens.js';
import {
  AccessModule,
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  MemoryAccessStore,
  MemoryLoginRateLimiter,
} from '../../access/index.js';
import { ContentModule } from '../content.module.js';
import { MEDIA_ASSET_STORE, MEDIA_CLOCK, OBJECT_STORAGE } from './application/ports.js';
import { MAX_FILE_SIZE_BYTES, PART_SIZE_BYTES } from './domain/upload-rules.js';
import { MemoryMediaAssetStore } from './infra/memory/memory-media-asset.store.js';

// E2E chạy app Nest thật (controller, guard, jose), chỉ thay database, Redis và S3 bằng bản bộ nhớ.
const env = { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' } as CoreEnv;
const NOW = new Date('2026-11-04T08:00:00.000Z');
const PASSWORD = 'mat-khau-an-toan';
const VALID_UPLOAD = { mimeType: 'video/mp4', fileSizeBytes: PART_SIZE_BYTES * 2 + 1, durationSec: 42.5 };

@Global()
@Module({
  providers: [
    { provide: CORE_ENV, useValue: env },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class FakePlatformModule {}

interface CreatedUploadBody {
  assetId: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

describe('media upload E2E', () => {
  let app: INestApplication;
  let mediaStore: MemoryMediaAssetStore;
  let objectStorage: InMemoryObjectStorage;
  let ownerToken: string;
  let otherToken: string;
  const http = () => request(app.getHttpServer());

  async function registerAndLogin(email: string): Promise<string> {
    await http().post('/api/auth/register').send({ email, password: PASSWORD, displayName: email }).expect(201);
    const response = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  const createUpload = (token: string, body: object = VALID_UPLOAD) =>
    http().post('/api/media/uploads').set('Authorization', `Bearer ${token}`).send(body);

  const resignParts = (token: string, assetId: string, partNumbers: unknown) =>
    http()
      .post(`/api/media/uploads/${assetId}/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partNumbers });

  beforeAll(async () => {
    mediaStore = new MemoryMediaAssetStore();
    objectStorage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        // @Transactional('access') của đăng ký cần CLS; store bộ nhớ nên không mở transaction database.
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
        ContentModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(new MemoryAccessStore())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .overrideProvider(MEDIA_ASSET_STORE)
      .useValue(mediaStore)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(objectStorage)
      .overrideProvider(MEDIA_CLOCK)
      .useValue(() => NOW)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
    ownerToken = await registerAndLogin('chu@example.com');
    otherToken = await registerAndLogin('khac@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/media/uploads', () => {
    it('cấp link cho từng phần và lưu video ở trạng thái uploading', async () => {
      const response = await createUpload(ownerToken).expect(201);
      const body = response.body as CreatedUploadBody;

      expect(body.partSizeBytes).toBe(PART_SIZE_BYTES);
      expect(body.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
      expect(body.expiresAt).toBe('2026-11-04T09:00:00.000Z');

      const stored = mediaStore.assets.get(body.assetId);
      expect(stored).toMatchObject({
        status: 'uploading',
        mimeType: 'video/mp4',
        fileSizeBytes: VALID_UPLOAD.fileSizeBytes,
        durationSec: 43,
        sourceKey: `dev/test/uploads/${body.assetId}/original.mp4`,
      });
      expect(stored?.s3UploadId).toBeTruthy();
    });

    it('trả 401 khi chưa đăng nhập', async () => {
      await http().post('/api/media/uploads').send(VALID_UPLOAD).expect(401);
    });

    it.each([
      ['dài quá 5 phút', { ...VALID_UPLOAD, durationSec: 300.5 }],
      ['lớn quá 1 GB', { ...VALID_UPLOAD, fileSizeBytes: MAX_FILE_SIZE_BYTES + 1 }],
    ])('trả 422 MEDIA_TOO_LARGE khi video %s', async (_label, body) => {
      const response = await createUpload(ownerToken, body).expect(422);
      expect(response.body).toEqual({ code: 'MEDIA_TOO_LARGE', message: expect.any(String) });
    });

    it.each([
      ['sai loại file', { ...VALID_UPLOAD, mimeType: 'video/avi' }],
      ['thiếu dung lượng', { mimeType: 'video/mp4', durationSec: 10 }],
      ['dung lượng bằng 0', { ...VALID_UPLOAD, fileSizeBytes: 0 }],
      ['dung lượng lẻ', { ...VALID_UPLOAD, fileSizeBytes: 1.5 }],
      ['thời lượng bằng 0', { ...VALID_UPLOAD, durationSec: 0 }],
    ])('trả 400 khi %s', async (_label, body) => {
      await createUpload(ownerToken, body).expect(400);
    });
  });

  describe('POST /api/media/uploads/:assetId/parts', () => {
    let assetId: string;

    beforeAll(async () => {
      const response = await createUpload(ownerToken).expect(201);
      assetId = (response.body as CreatedUploadBody).assetId;
    });

    it('ký lại đúng các phần còn thiếu và bỏ số trùng', async () => {
      const response = await resignParts(ownerToken, assetId, [2, 3, 2]).expect(200);
      const body = response.body as { parts: { partNumber: number }[]; expiresAt: string };

      expect(body.parts.map((part) => part.partNumber)).toEqual([2, 3]);
      expect(body.expiresAt).toBe('2026-11-04T09:00:00.000Z');
    });

    it('trả 401 khi chưa đăng nhập', async () => {
      await http().post(`/api/media/uploads/${assetId}/parts`).send({ partNumbers: [1] }).expect(401);
    });

    it('trả 404 khi video là của người khác', async () => {
      const response = await resignParts(otherToken, assetId, [1]).expect(404);
      expect(response.body).toMatchObject({ code: 'MEDIA_NOT_FOUND' });
    });

    it('trả 404 khi video không tồn tại', async () => {
      const response = await resignParts(ownerToken, '00000000-0000-4000-8000-000000000000', [1]).expect(404);
      expect(response.body).toMatchObject({ code: 'MEDIA_NOT_FOUND' });
    });

    it('trả 409 khi video không còn ở trạng thái uploading', async () => {
      const created = await createUpload(ownerToken).expect(201);
      const processingId = (created.body as CreatedUploadBody).assetId;
      const stored = mediaStore.assets.get(processingId);
      mediaStore.assets.set(processingId, { ...stored!, status: 'processing' });

      const response = await resignParts(ownerToken, processingId, [1]).expect(409);
      expect(response.body).toMatchObject({ code: 'MEDIA_UPLOAD_NOT_ACTIVE' });
    });

    it('trả 400 khi số phần vượt quá số phần của file', async () => {
      const response = await resignParts(ownerToken, assetId, [4]).expect(400);
      expect(response.body).toMatchObject({ code: 'MEDIA_INVALID_PART_NUMBER' });
    });

    it.each([
      ['danh sách rỗng', []],
      ['số phần bằng 0', [0]],
      ['số phần lẻ', [1.5]],
    ])('trả 400 khi %s', async (_label, partNumbers) => {
      await resignParts(ownerToken, assetId, partNumbers).expect(400);
    });

    it('trả 400 khi assetId không phải uuid', async () => {
      await resignParts(ownerToken, 'khong-phai-uuid', [1]).expect(400);
    });
  });

  describe('POST /api/media/uploads/:assetId/complete', () => {
    const BODY = Buffer.from('hello world');

    const completeUpload = (token: string, assetId: string, parts: unknown) =>
      http().post(`/api/media/uploads/${assetId}/complete`).set('Authorization', `Bearer ${token}`).send({ parts });

    async function createUploadedAsset() {
      const created = await createUpload(ownerToken, {
        mimeType: 'video/mp4',
        fileSizeBytes: BODY.byteLength,
        durationSec: 5,
      }).expect(201);
      const assetId = (created.body as CreatedUploadBody).assetId;
      const asset = mediaStore.assets.get(assetId)!;
      const etag = objectStorage.uploadPartForTest(asset.s3UploadId, 1, BODY);
      return { assetId, asset, parts: [{ partNumber: 1, etag }] };
    }

    it('trả 202 processing, ghép file và ghi đúng một việc chuyển mã khi gọi lại', async () => {
      const { assetId, asset, parts } = await createUploadedAsset();

      const first = await completeUpload(ownerToken, assetId, parts).expect(202);
      const second = await completeUpload(ownerToken, assetId, parts).expect(202);

      expect(first.body).toEqual({ assetId, status: 'processing' });
      expect(second.body).toEqual({ assetId, status: 'processing' });
      expect(objectStorage.getStoredObjectForTest(asset.sourceKey)?.body).toEqual(BODY);
      const events = mediaStore.outboxRows.filter((event) => event.payload.assetId === assetId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'content.media.transcode_requested',
        payload: { assetId, sourceKey: asset.sourceKey, revision: 1 },
      });
    });

    it('trả 401 khi chưa đăng nhập', async () => {
      const { assetId, parts } = await createUploadedAsset();
      await http().post(`/api/media/uploads/${assetId}/complete`).send({ parts }).expect(401);
    });

    it('trả 404 khi video là của người khác', async () => {
      const { assetId, parts } = await createUploadedAsset();
      const response = await completeUpload(otherToken, assetId, parts).expect(404);
      expect(response.body).toMatchObject({ code: 'MEDIA_NOT_FOUND' });
    });

    it('trả 409 MEDIA_UPLOAD_INCOMPLETE khi ETag sai', async () => {
      const { assetId } = await createUploadedAsset();
      const response = await completeUpload(ownerToken, assetId, [{ partNumber: 1, etag: '"sai"' }]).expect(409);
      expect(response.body).toMatchObject({ code: 'MEDIA_UPLOAD_INCOMPLETE' });
    });

    it('trả 409 MEDIA_UPLOAD_INCOMPLETE khi thiếu phần', async () => {
      const created = await createUpload(ownerToken).expect(201);
      const assetId = (created.body as CreatedUploadBody).assetId;
      const response = await completeUpload(ownerToken, assetId, [{ partNumber: 1, etag: '"a"' }]).expect(409);
      expect(response.body).toMatchObject({ code: 'MEDIA_UPLOAD_INCOMPLETE' });
    });

    it('trả 410 MEDIA_UPLOAD_EXPIRED khi phiên upload đã bị xoá', async () => {
      const { assetId, asset, parts } = await createUploadedAsset();
      objectStorage.expireUploadForTest(asset.s3UploadId);
      const response = await completeUpload(ownerToken, assetId, parts).expect(410);
      expect(response.body).toMatchObject({ code: 'MEDIA_UPLOAD_EXPIRED' });
    });

    it.each([
      ['danh sách rỗng', []],
      ['thiếu ETag', [{ partNumber: 1 }]],
      ['ETag rỗng', [{ partNumber: 1, etag: '' }]],
      ['số phần bằng 0', [{ partNumber: 0, etag: '"a"' }]],
    ])('trả 400 khi %s', async (_label, parts) => {
      const { assetId } = await createUploadedAsset();
      await completeUpload(ownerToken, assetId, parts).expect(400);
    });

    it('trả 400 khi assetId không phải uuid', async () => {
      await completeUpload(ownerToken, 'khong-phai-uuid', [{ partNumber: 1, etag: '"a"' }]).expect(400);
    });
  });
});
