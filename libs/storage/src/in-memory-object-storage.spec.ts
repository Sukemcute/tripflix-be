import { InMemoryObjectStorage } from './in-memory-object-storage.js';
import { ObjectNotFoundError, UploadExpiredError, UploadIncompleteError } from './object-storage.js';

const KEY = 'dev/phong/uploads/asset-1/original.mp4';

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe('InMemoryObjectStorage', () => {
  it('ghép các phần theo số thứ tự khi hoàn tất upload', async () => {
    const storage = new InMemoryObjectStorage();
    const uploadId = await storage.createMultipartUpload({ key: KEY, contentType: 'video/mp4' });
    const etag2 = storage.uploadPartForTest(uploadId, 2, Buffer.from('world'));
    const etag1 = storage.uploadPartForTest(uploadId, 1, Buffer.from('hello '));

    await storage.completeMultipartUpload({
      key: KEY,
      uploadId,
      parts: [
        { partNumber: 2, etag: etag2 },
        { partNumber: 1, etag: etag1 },
      ],
    });

    expect(await storage.getObjectSizeBytes(KEY)).toBe(11);
    expect(await readAll(await storage.getObject(KEY))).toBe('hello world');
  });

  it('báo UploadIncompleteError khi ETag không khớp', async () => {
    const storage = new InMemoryObjectStorage();
    const uploadId = await storage.createMultipartUpload({ key: KEY, contentType: 'video/mp4' });
    storage.uploadPartForTest(uploadId, 1, Buffer.from('hello'));

    await expect(
      storage.completeMultipartUpload({ key: KEY, uploadId, parts: [{ partNumber: 1, etag: '"sai"' }] }),
    ).rejects.toBeInstanceOf(UploadIncompleteError);
  });

  it('báo UploadIncompleteError khi thiếu phần', async () => {
    const storage = new InMemoryObjectStorage();
    const uploadId = await storage.createMultipartUpload({ key: KEY, contentType: 'video/mp4' });

    await expect(
      storage.completeMultipartUpload({ key: KEY, uploadId, parts: [{ partNumber: 1, etag: '"a"' }] }),
    ).rejects.toBeInstanceOf(UploadIncompleteError);
    await expect(storage.completeMultipartUpload({ key: KEY, uploadId, parts: [] })).rejects.toBeInstanceOf(
      UploadIncompleteError,
    );
  });

  it('báo UploadExpiredError khi phiên upload đã bị xoá', async () => {
    const storage = new InMemoryObjectStorage();
    const uploadId = await storage.createMultipartUpload({ key: KEY, contentType: 'video/mp4' });
    const etag = storage.uploadPartForTest(uploadId, 1, Buffer.from('hello'));
    storage.expireUploadForTest(uploadId);

    await expect(
      storage.completeMultipartUpload({ key: KEY, uploadId, parts: [{ partNumber: 1, etag }] }),
    ).rejects.toBeInstanceOf(UploadExpiredError);
  });

  it('báo ObjectNotFoundError khi file không tồn tại', async () => {
    const storage = new InMemoryObjectStorage();

    await expect(storage.getObjectSizeBytes(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(storage.getObject(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('lưu Cache-Control khi ghi file', async () => {
    const storage = new InMemoryObjectStorage();
    await storage.putObject({
      key: 'videos/a/r1/master.m3u8',
      body: Buffer.from('#EXTM3U'),
      contentType: 'application/vnd.apple.mpegurl',
      cacheControl: 'max-age=60',
    });

    expect(storage.getStoredObjectForTest('videos/a/r1/master.m3u8')?.cacheControl).toBe('max-age=60');
  });

  it('thêm tiền tố vào khoá và tạo link CDN', () => {
    const storage = new InMemoryObjectStorage({ keyPrefix: 'dev/phong/', cdnBaseUrl: 'https://cdn.test/' });
    const key = storage.resolveKey('videos/a/r1/master.m3u8');

    expect(key).toBe('dev/phong/videos/a/r1/master.m3u8');
    expect(storage.getCdnUrl(key)).toBe('https://cdn.test/dev/phong/videos/a/r1/master.m3u8');
  });
});
