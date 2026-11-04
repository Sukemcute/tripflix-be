import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { InMemoryObjectStorage } from '@tripflix/storage';
import request from 'supertest';
import type { CoreEnv } from '../../../platform/env.js';
import { applyGlobalPrefix } from '../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../platform/tokens.js';
import { AccessModule } from '../../access/access.module.js';
import { ACCESS_SID_BLOCKLIST, ACCESS_STORE, LOGIN_RATE_LIMITER } from '../../access/auth/application/ports.js';
import { MemoryAccessStore } from '../../access/auth/infra/memory/memory-access.store.js';
import { MemoryLoginRateLimiter } from '../../access/auth/infra/memory/memory-login-rate-limiter.js';
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
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AccessModule, ContentModule] })
      .overrideProvider(ACCESS_STORE)
      .useValue(new MemoryAccessStore())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .overrideProvider(MEDIA_ASSET_STORE)
      .useValue(mediaStore)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new InMemoryObjectStorage({ keyPrefix: 'dev/test/' }))
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
});
