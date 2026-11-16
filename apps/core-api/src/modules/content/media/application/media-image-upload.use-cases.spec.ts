import { InMemoryObjectStorage } from '@tripflix/storage';
import { MediaError } from '../domain/errors.js';
import { MAX_IMAGE_FILE_SIZE_BYTES, detectImageMimeType } from '../domain/upload-rules.js';
import { MemoryMediaAssetStore } from '../infra/memory/memory-media-asset.store.js';
import { MediaFacade } from '../media.facade.js';
import { MediaUploadUseCases } from './media-upload.use-cases.js';

const NOW = new Date('2026-11-13T08:00:00.000Z');
const OWNER_ID = 'owner-1';

/** Đủ chữ ký định dạng ở đầu file; phần sau chỉ để file có kích thước. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_BYTES = Buffer.from('RIFF\u0010\u0000\u0000\u0000WEBPVP8 ', 'latin1');

function createUseCases() {
  const store = new MemoryMediaAssetStore();
  const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' });
  return {
    store,
    storage,
    useCases: new MediaUploadUseCases(store, storage, () => NOW),
    facade: new MediaFacade(store, storage),
  };
}

/** Tải đúng nội dung `body` lên phần duy nhất rồi gọi hoàn tất, như web làm. */
async function uploadImage(
  context: ReturnType<typeof createUseCases>,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  body: Buffer,
) {
  const created = await context.useCases.createUpload(OWNER_ID, {
    mimeType,
    fileSizeBytes: body.length,
    widthPx: 1080,
    heightPx: 1350,
  });
  const asset = context.store.assets.get(created.assetId)!;
  const etag = context.storage.uploadPartForTest(asset.s3UploadId, 1, body);
  return { created, asset, complete: () => context.useCases.completeUpload(OWNER_ID, created.assetId, [{ partNumber: 1, etag }]) };
}

describe('Upload ảnh bài viết', () => {
  it('ảnh chỉ có một link PUT, nằm ở nhánh images/posts/, không cần thời lượng', async () => {
    const context = createUseCases();
    const { created, asset } = await uploadImage(context, 'image/png', PNG_BYTES);

    expect(created.parts).toHaveLength(1);
    expect(asset.kind).toBe('image');
    expect(asset.durationSec).toBeNull();
    expect(asset.sourceKey).toBe(`dev/test/images/posts/${created.assetId}.png`);
    expect([asset.widthPx, asset.heightPx]).toEqual([1080, 1350]);
  });

  it('hoàn tất thì ảnh ready ngay, không giao việc chuyển mã cho video-worker', async () => {
    const context = createUseCases();
    const { created, complete } = await uploadImage(context, 'image/jpeg', JPEG_BYTES);

    await expect(complete()).resolves.toEqual({ assetId: created.assetId, status: 'ready' });
    expect(context.store.assets.get(created.assetId)?.status).toBe('ready');
    expect(context.store.outboxRows).toHaveLength(0);
    // Gọi lại vẫn cùng kết quả.
    await expect(complete()).resolves.toEqual({ assetId: created.assetId, status: 'ready' });
  });

  it('file không đúng định dạng đã khai thì bị từ chối và đánh dấu failed', async () => {
    const context = createUseCases();
    const { created, complete } = await uploadImage(context, 'image/jpeg', Buffer.from('<html>không phải ảnh'));

    await expect(complete()).rejects.toMatchObject({ code: 'MEDIA_INVALID_IMAGE' });
    expect(context.store.assets.get(created.assetId)?.status).toBe('failed');
  });

  it('ảnh khai PNG mà file là JPEG cũng bị từ chối', async () => {
    const context = createUseCases();
    const { complete } = await uploadImage(context, 'image/png', JPEG_BYTES);

    await expect(complete()).rejects.toMatchObject({ code: 'MEDIA_INVALID_IMAGE' });
  });

  it('ảnh quá 10 MB thì không gọi S3', async () => {
    const context = createUseCases();
    const createMultipartUpload = vi.spyOn(context.storage, 'createMultipartUpload');

    await expect(
      context.useCases.createUpload(OWNER_ID, { mimeType: 'image/webp', fileSizeBytes: MAX_IMAGE_FILE_SIZE_BYTES + 1 }),
    ).rejects.toBeInstanceOf(MediaError);
    expect(createMultipartUpload).not.toHaveBeenCalled();
  });

  it('MediaFacade.getImages chỉ trả ảnh ready kèm link CDN; video và ảnh chưa xong thì không có', async () => {
    const context = createUseCases();
    const ready = await uploadImage(context, 'image/webp', WEBP_BYTES);
    await ready.complete();
    const pending = await uploadImage(context, 'image/jpeg', JPEG_BYTES);
    const video = await context.useCases.createUpload(OWNER_ID, { mimeType: 'video/mp4', fileSizeBytes: 5, durationSec: 3 });

    const images = await context.facade.getImages([ready.created.assetId, pending.created.assetId, video.assetId]);

    expect(Object.keys(images)).toEqual([ready.created.assetId]);
    expect(images[ready.created.assetId]).toEqual({
      url: `https://cdn.test/dev/test/images/posts/${ready.created.assetId}.webp`,
      widthPx: 1080,
      heightPx: 1350,
    });
    const kinds = await context.facade.getKinds([ready.created.assetId, video.assetId, 'missing']);
    expect(kinds.map(({ id, kind, status }) => [id, kind, status])).toEqual([
      [ready.created.assetId, 'image', 'ready'],
      [video.assetId, 'video', 'uploading'],
    ]);
  });
});

describe('detectImageMimeType', () => {
  it('nhận đúng JPEG, PNG, WebP từ byte đầu file; file khác thì null', () => {
    expect(detectImageMimeType(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectImageMimeType(PNG_BYTES)).toBe('image/png');
    expect(detectImageMimeType(WEBP_BYTES)).toBe('image/webp');
    expect(detectImageMimeType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageMimeType(Buffer.from('RIFF....WAVE'))).toBeNull();
  });
});
