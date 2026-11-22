import { Readable } from 'node:stream';
import { CompleteMultipartUploadCommand, type S3Client } from '@aws-sdk/client-s3';
import { ObjectNotFoundError, UploadExpiredError, UploadIncompleteError } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

const BUCKET = 'tripflix-media-test';
const KEY = 'dev/phong/uploads/asset-1/original.mp4';

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function createStorageWithSend(send: (command: unknown) => Promise<unknown>): S3ObjectStorage {
  const client = { send } as unknown as S3Client;
  return new S3ObjectStorage({
    region: 'ap-southeast-1',
    bucket: BUCKET,
    keyPrefix: 'dev/phong/',
    cdnBaseUrl: 'https://cdn.test',
    client,
  });
}

describe('S3ObjectStorage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ký link tải một phần, không kèm checksum mà app không gửi được', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-value');
    const storage = new S3ObjectStorage({
      region: 'ap-southeast-1',
      bucket: BUCKET,
      keyPrefix: 'dev/phong/',
      cdnBaseUrl: 'https://cdn.test',
    });

    const url = new URL(
      await storage.signUploadPart({ key: KEY, uploadId: 'upload-1', partNumber: 3, expiresInSeconds: 3600 }),
    );

    expect(url.pathname).toContain(KEY);
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('upload-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.search.toLowerCase()).not.toContain('checksum');
  });

  it('gửi các phần theo thứ tự tăng dần khi hoàn tất upload', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createStorageWithSend(send);

    await storage.completeMultipartUpload({
      key: KEY,
      uploadId: 'upload-1',
      parts: [
        { partNumber: 2, etag: '"b"' },
        { partNumber: 1, etag: '"a"' },
      ],
    });

    const command = send.mock.calls[0]?.[0] as CompleteMultipartUploadCommand;
    expect(command).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(command.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
    ]);
  });

  it.each([
    ['NoSuchUpload', UploadExpiredError],
    ['InvalidPart', UploadIncompleteError],
    ['InvalidPartOrder', UploadIncompleteError],
    ['EntityTooSmall', UploadIncompleteError],
  ])('đổi lỗi S3 %s khi hoàn tất upload sang lỗi của thư viện', async (errorName, expectedError) => {
    const storage = createStorageWithSend(() => Promise.reject(namedError(errorName)));

    await expect(
      storage.completeMultipartUpload({ key: KEY, uploadId: 'upload-1', parts: [{ partNumber: 1, etag: '"a"' }] }),
    ).rejects.toBeInstanceOf(expectedError);
  });

  it('giữ nguyên lỗi S3 không liên quan tới upload, để không báo nhầm cho người dùng', async () => {
    const storage = createStorageWithSend(() => Promise.reject(namedError('SlowDown')));

    await expect(
      storage.completeMultipartUpload({ key: KEY, uploadId: 'upload-1', parts: [{ partNumber: 1, etag: '"a"' }] }),
    ).rejects.toThrow('SlowDown');
  });

  it.each(['NotFound', 'NoSuchKey'])('đổi lỗi S3 %s sang ObjectNotFoundError', async (errorName) => {
    const storage = createStorageWithSend(() => Promise.reject(namedError(errorName)));

    await expect(storage.getObjectSizeBytes(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(storage.getObject(KEY)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('trả dung lượng và nội dung file', async () => {
    const body = Readable.from([Buffer.from('video')]);
    const send = vi.fn().mockResolvedValueOnce({ ContentLength: 5 }).mockResolvedValueOnce({ Body: body });
    const storage = createStorageWithSend(send);

    expect(await storage.getObjectSizeBytes(KEY)).toBe(5);
    expect(await storage.getObject(KEY)).toBe(body);
  });

  it('thêm tiền tố vào khoá và tạo link CDN', () => {
    const storage = createStorageWithSend(() => Promise.resolve({}));
    const key = storage.resolveKey('uploads/asset-1/original.mp4');

    expect(key).toBe(KEY);
    expect(storage.getCdnUrl(key)).toBe(`https://cdn.test/${KEY}`);
  });
});
