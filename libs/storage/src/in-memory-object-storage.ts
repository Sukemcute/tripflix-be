import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ObjectNotFoundError,
  UploadExpiredError,
  UploadIncompleteError,
  buildCdnUrl,
  joinKeyPrefix,
  type CompleteMultipartUploadInput,
  type CreateMultipartUploadInput,
  type ObjectStorage,
  type PutObjectInput,
  type SignUploadPartInput,
} from './object-storage.js';

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

interface PendingUpload {
  key: string;
  contentType: string;
  parts: Map<number, { etag: string; body: Uint8Array }>;
}

export interface InMemoryObjectStorageOptions {
  keyPrefix?: string;
  cdnBaseUrl?: string;
}

/** Bản dùng cho test, không cần mạng. Làm theo các lỗi của S3 mà nghiệp vụ phải xử lý. */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly keyPrefix: string;
  private readonly cdnBaseUrl: string;

  constructor({ keyPrefix = '', cdnBaseUrl = 'https://cdn.test' }: InMemoryObjectStorageOptions = {}) {
    this.keyPrefix = keyPrefix;
    this.cdnBaseUrl = cdnBaseUrl;
  }

  resolveKey(relativeKey: string): string {
    return joinKeyPrefix(this.keyPrefix, relativeKey);
  }

  getCdnUrl(key: string): string {
    return buildCdnUrl(this.cdnBaseUrl, key);
  }

  createMultipartUpload({ key, contentType }: CreateMultipartUploadInput): Promise<string> {
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { key, contentType, parts: new Map() });
    return Promise.resolve(uploadId);
  }

  signUploadPart({ key, uploadId, partNumber, expiresInSeconds }: SignUploadPartInput): Promise<string> {
    const query = new URLSearchParams({
      uploadId,
      partNumber: String(partNumber),
      expiresIn: String(expiresInSeconds),
    });
    return Promise.resolve(`memory://${key}?${query.toString()}`);
  }

  completeMultipartUpload({ key, uploadId, parts }: CompleteMultipartUploadInput): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) {
      return Promise.reject(new UploadExpiredError(`Phiên upload của ${key} không còn`));
    }
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const bodies: Uint8Array[] = [];
    for (const part of sortedParts) {
      const stored = upload.parts.get(part.partNumber);
      if (!stored || stored.etag !== part.etag) {
        return Promise.reject(new UploadIncompleteError(`Phần ${part.partNumber} của ${key} không khớp`));
      }
      bodies.push(stored.body);
    }
    if (bodies.length === 0) {
      return Promise.reject(new UploadIncompleteError(`Upload của ${key} chưa có phần nào`));
    }
    this.objects.set(key, { body: Buffer.concat(bodies), contentType: upload.contentType });
    this.uploads.delete(uploadId);
    return Promise.resolve();
  }

  getObjectSizeBytes(key: string): Promise<number> {
    const stored = this.objects.get(key);
    if (!stored) return Promise.reject(new ObjectNotFoundError(`Không thấy ${key}`));
    return Promise.resolve(stored.body.byteLength);
  }

  getObject(key: string): Promise<Readable> {
    const stored = this.objects.get(key);
    if (!stored) return Promise.reject(new ObjectNotFoundError(`Không thấy ${key}`));
    return Promise.resolve(Readable.from([Buffer.from(stored.body)]));
  }

  putObject({ key, body, contentType, cacheControl }: PutObjectInput): Promise<void> {
    this.objects.set(key, { body, contentType, cacheControl });
    return Promise.resolve();
  }

  /** Thay cho việc app PUT một phần lên link đã ký. Trả về ETag như S3. */
  uploadPartForTest(uploadId: string, partNumber: number, body: Uint8Array): string {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new UploadExpiredError(`Không có phiên upload ${uploadId}`);
    const etag = `"${createHash('md5').update(body).digest('hex')}"`;
    upload.parts.set(partNumber, { etag, body });
    return etag;
  }

  /** Giả lập lifecycle của S3 xoá phần tải dở. */
  expireUploadForTest(uploadId: string): void {
    this.uploads.delete(uploadId);
  }

  getStoredObjectForTest(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }
}
