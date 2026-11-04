import type { Readable } from 'node:stream';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface CreateMultipartUploadInput {
  key: string;
  contentType: string;
}

export interface SignUploadPartInput {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}

export interface CompleteMultipartUploadInput {
  key: string;
  uploadId: string;
  parts: UploadedPart[];
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

/**
 * Code nghiệp vụ chỉ phụ thuộc interface này, để test chạy bằng bộ nhớ mà không cần mạng.
 * Mọi tham số `key` là khoá đầy đủ, lấy từ resolveKey, và là giá trị lưu trong database.
 */
export interface ObjectStorage {
  /** Thêm tiền tố môi trường (ví dụ dev/phong/) vào khoá tương đối. */
  resolveKey(relativeKey: string): string;
  getCdnUrl(key: string): string;
  /** Trả về uploadId. */
  createMultipartUpload(input: CreateMultipartUploadInput): Promise<string>;
  signUploadPart(input: SignUploadPartInput): Promise<string>;
  /**
   * @throws {UploadExpiredError} phiên upload không còn trên kho.
   * @throws {UploadIncompleteError} thiếu phần hoặc ETag không khớp.
   */
  completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void>;
  /** @throws {ObjectNotFoundError} */
  getObjectSizeBytes(key: string): Promise<number>;
  /** @throws {ObjectNotFoundError} */
  getObject(key: string): Promise<Readable>;
  putObject(input: PutObjectInput): Promise<void>;
}

export class UploadExpiredError extends Error {
  override readonly name = 'UploadExpiredError';
}

export class UploadIncompleteError extends Error {
  override readonly name = 'UploadIncompleteError';
}

export class ObjectNotFoundError extends Error {
  override readonly name = 'ObjectNotFoundError';
}

export function joinKeyPrefix(keyPrefix: string, relativeKey: string): string {
  const prefix = keyPrefix.replace(/\/+$/, '');
  const key = relativeKey.replace(/^\/+/, '');
  return prefix ? `${prefix}/${key}` : key;
}

export function buildCdnUrl(cdnBaseUrl: string, key: string): string {
  return `${cdnBaseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
