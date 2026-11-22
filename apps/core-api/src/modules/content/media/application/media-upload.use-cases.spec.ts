import { InMemoryObjectStorage } from '@tripflix/storage';
import { MediaError } from '../domain/errors.js';
import { MemoryMediaAssetStore } from '../infra/memory/memory-media-asset.store.js';
import { MediaUploadUseCases } from './media-upload.use-cases.js';

const NOW = new Date('2026-11-04T08:00:00.000Z');
const OWNER_ID = 'owner-1';

function createUseCases() {
  const store = new MemoryMediaAssetStore();
  const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/' });
  return { store, storage, useCases: new MediaUploadUseCases(store, storage, () => NOW) };
}

describe('MediaUploadUseCases', () => {
  it('link ký sẵn dùng được với phiên upload đã lưu, và ghép đủ file', async () => {
    const { store, storage, useCases } = createUseCases();
    const created = await useCases.createUpload(OWNER_ID, {
      mimeType: 'video/quicktime',
      fileSizeBytes: 11,
      durationSec: 5,
    });

    const asset = store.assets.get(created.assetId)!;
    expect(asset.sourceKey).toBe(`dev/test/uploads/${created.assetId}/original.mov`);
    expect(created.parts[0]?.url).toContain(asset.s3UploadId);

    const etag = storage.uploadPartForTest(asset.s3UploadId, 1, Buffer.from('hello world'));
    await storage.completeMultipartUpload({
      key: asset.sourceKey,
      uploadId: asset.s3UploadId,
      parts: [{ partNumber: 1, etag }],
    });
    expect(await storage.getObjectSizeBytes(asset.sourceKey)).toBe(asset.fileSizeBytes);
  });

  it('không gọi S3 khi video vượt giới hạn', async () => {
    const { storage, store, useCases } = createUseCases();
    const createMultipartUpload = vi.spyOn(storage, 'createMultipartUpload');

    await expect(
      useCases.createUpload(OWNER_ID, { mimeType: 'video/mp4', fileSizeBytes: 1, durationSec: 301 }),
    ).rejects.toBeInstanceOf(MediaError);

    expect(createMultipartUpload).not.toHaveBeenCalled();
    expect(store.assets.size).toBe(0);
  });

  it('không lưu video khi S3 lỗi', async () => {
    const { storage, store, useCases } = createUseCases();
    vi.spyOn(storage, 'createMultipartUpload').mockRejectedValue(new Error('S3 lỗi'));

    await expect(
      useCases.createUpload(OWNER_ID, { mimeType: 'video/mp4', fileSizeBytes: 1, durationSec: 1 }),
    ).rejects.toThrow('S3 lỗi');

    expect(store.assets.size).toBe(0);
  });

  it('coi video không có phiên upload là không còn tải lên được', async () => {
    const { store, useCases } = createUseCases();
    await store.insertUploadingAsset({
      id: 'seeded',
      ownerId: OWNER_ID,
      mimeType: 'video/mp4',
      fileSizeBytes: 1,
      sourceKey: 'k',
      s3UploadId: '',
      durationSec: 1,
    });

    await expect(useCases.resignParts(OWNER_ID, 'seeded', [1])).rejects.toMatchObject({
      code: 'MEDIA_UPLOAD_NOT_ACTIVE',
    });
  });
});
