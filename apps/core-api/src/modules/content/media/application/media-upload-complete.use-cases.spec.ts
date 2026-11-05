import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { ClsModule } from 'nestjs-cls';
import { PART_SIZE_BYTES } from '../domain/upload-rules.js';
import { MemoryMediaAssetStore } from '../infra/memory/memory-media-asset.store.js';
import { MediaUploadUseCases } from './media-upload.use-cases.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const BODY = Buffer.from('hello world');

// Khởi tạo TransactionHost (plugin no-op) một lần để @Transactional('content') chạy được khi tạo use case trực tiếp.
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
  }).compile();
  await moduleRef.init();
});

async function setup(fileSizeBytes = BODY.byteLength) {
  const store = new MemoryMediaAssetStore();
  const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
  const useCases = new MediaUploadUseCases(store, storage, () => new Date('2026-11-05T08:00:00.000Z'));
  const { assetId } = await useCases.createUpload(OWNER_ID, { mimeType: 'video/mp4', fileSizeBytes, durationSec: 5 });
  const asset = store.assets.get(assetId)!;
  const etag = storage.uploadPartForTest(asset.s3UploadId, 1, BODY);
  return { store, storage, useCases, assetId, asset, parts: [{ partNumber: 1, etag }] };
}

describe('MediaUploadUseCases.completeUpload', () => {
  it('ghép file, chuyển processing và ghi đúng một việc chuyển mã', async () => {
    const { store, storage, useCases, assetId, asset, parts } = await setup();

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'processing' });

    expect(storage.getStoredObjectForTest(asset.sourceKey)?.body).toEqual(BODY);
    expect(asset).toMatchObject({ status: 'processing', transcodeAttempts: 1 });
    expect(store.outboxRows).toHaveLength(1);
    expect(store.outboxRows[0]).toMatchObject({
      type: 'content.media.transcode_requested',
      version: 1,
      userId: OWNER_ID,
      payload: { assetId, sourceKey: asset.sourceKey, revision: 1 },
    });
  });

  it('gọi lại khi đã processing thì trả kết quả cũ, không gọi S3 và không ghi thêm sự kiện', async () => {
    const { store, storage, useCases, assetId, parts } = await setup();
    await useCases.completeUpload(OWNER_ID, assetId, parts);
    const completeMultipartUpload = vi.spyOn(storage, 'completeMultipartUpload');

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'processing' });

    expect(completeMultipartUpload).not.toHaveBeenCalled();
    expect(store.outboxRows).toHaveLength(1);
  });

  it('gọi lại khi video đã ready thì trả ready', async () => {
    const { store, useCases, assetId, asset, parts } = await setup();
    asset.status = 'ready';

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'ready' });
    expect(store.outboxRows).toHaveLength(0);
  });

  it('hai lần gọi cùng lúc chỉ giao một việc chuyển mã', async () => {
    const { store, useCases, assetId, parts } = await setup();

    const results = await Promise.all([
      useCases.completeUpload(OWNER_ID, assetId, parts),
      useCases.completeUpload(OWNER_ID, assetId, parts),
    ]);

    expect(results).toEqual([
      { assetId, status: 'processing' },
      { assetId, status: 'processing' },
    ]);
    expect(store.outboxRows).toHaveLength(1);
  });

  it('S3 đã ghép xong nhưng ghi database lỗi: gọi lại vẫn thành công', async () => {
    const { store, useCases, assetId, asset, parts } = await setup();
    vi.spyOn(store, 'markProcessing').mockRejectedValueOnce(new Error('database lỗi'));

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toThrow('database lỗi');
    expect(asset.status).toBe('uploading');

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).resolves.toEqual({ assetId, status: 'processing' });
    expect(store.outboxRows).toHaveLength(1);
  });

  it('video của người khác thì báo không tìm thấy', async () => {
    const { store, useCases, assetId, parts } = await setup();

    await expect(useCases.completeUpload(OTHER_ID, assetId, parts)).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' });
    expect(store.outboxRows).toHaveLength(0);
  });

  it('video đã failed thì không giao việc lại', async () => {
    const { store, useCases, assetId, asset, parts } = await setup();
    asset.status = 'failed';

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_NOT_ACTIVE',
    });
    expect(store.outboxRows).toHaveLength(0);
  });

  it('thiếu phần thì không gọi S3, phiên upload còn nguyên để tải tiếp', async () => {
    const { storage, useCases, assetId, asset, parts } = await setup(PART_SIZE_BYTES + 1);
    const completeMultipartUpload = vi.spyOn(storage, 'completeMultipartUpload');

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_INCOMPLETE',
    });

    expect(completeMultipartUpload).not.toHaveBeenCalled();
    expect(asset.status).toBe('uploading');
  });

  it('ETag sai thì báo thiếu phần, video vẫn uploading', async () => {
    const { store, useCases, assetId, asset } = await setup();

    await expect(
      useCases.completeUpload(OWNER_ID, assetId, [{ partNumber: 1, etag: '"sai"' }]),
    ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_INCOMPLETE' });

    expect(asset.status).toBe('uploading');
    expect(store.outboxRows).toHaveLength(0);
  });

  it('phiên upload đã bị S3 xoá và chưa có file thì báo hết hạn', async () => {
    const { store, storage, useCases, assetId, asset, parts } = await setup();
    storage.expireUploadForTest(asset.s3UploadId);

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_EXPIRED',
    });
    expect(store.outboxRows).toHaveLength(0);
  });

  it('dung lượng file khác lúc xin link thì không giao việc chuyển mã', async () => {
    const { store, useCases, assetId, asset, parts } = await setup(BODY.byteLength + 1);

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_INCOMPLETE',
    });

    expect(asset.status).toBe('uploading');
    expect(store.outboxRows).toHaveLength(0);
  });

  it('S3 lỗi khác thì ném nguyên lỗi để app thử lại, video vẫn uploading', async () => {
    const { storage, useCases, assetId, asset, parts } = await setup();
    vi.spyOn(storage, 'completeMultipartUpload').mockRejectedValueOnce(new Error('S3 lỗi'));

    await expect(useCases.completeUpload(OWNER_ID, assetId, parts)).rejects.toThrow('S3 lỗi');
    expect(asset.status).toBe('uploading');
  });
});
