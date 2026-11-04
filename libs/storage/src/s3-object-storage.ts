import { Readable } from 'node:stream';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

const UPLOAD_EXPIRED_ERROR_NAMES = new Set(['NoSuchUpload']);
const UPLOAD_INCOMPLETE_ERROR_NAMES = new Set(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall']);
const OBJECT_NOT_FOUND_ERROR_NAMES = new Set(['NoSuchKey', 'NotFound']);

export interface S3ObjectStorageOptions {
  region: string;
  bucket: string;
  /** Ví dụ dev/phong/ ở dev; để trống ở production. */
  keyPrefix: string;
  cdnBaseUrl: string;
  /** Không truyền thì tự tạo client, lấy key từ biến môi trường AWS_*. */
  client?: S3Client;
}

export function createS3Client(region: string): S3Client {
  // Mặc định SDK gắn checksum CRC32 vào link ký sẵn. App tải lên không gửi được checksum đó nên S3 sẽ từ chối.
  return new S3Client({
    region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function hasErrorName(error: unknown, names: Set<string>): boolean {
  return error instanceof Error && names.has(error.name);
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly cdnBaseUrl: string;

  constructor(options: S3ObjectStorageOptions) {
    this.client = options.client ?? createS3Client(options.region);
    this.bucket = options.bucket;
    this.keyPrefix = options.keyPrefix;
    this.cdnBaseUrl = options.cdnBaseUrl;
  }

  resolveKey(relativeKey: string): string {
    return joinKeyPrefix(this.keyPrefix, relativeKey);
  }

  getCdnUrl(key: string): string {
    return buildCdnUrl(this.cdnBaseUrl, key);
  }

  async createMultipartUpload({ key, contentType }: CreateMultipartUploadInput): Promise<string> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!response.UploadId) throw new Error(`S3 không trả về UploadId cho ${key}`);
    return response.UploadId;
  }

  signUploadPart({ key, uploadId, partNumber, expiresInSeconds }: SignUploadPartInput): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: expiresInSeconds },
    );
  }

  async completeMultipartUpload({ key, uploadId, parts }: CompleteMultipartUploadInput): Promise<void> {
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sortedParts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    } catch (error) {
      if (hasErrorName(error, UPLOAD_EXPIRED_ERROR_NAMES)) {
        throw new UploadExpiredError(`Phiên upload của ${key} không còn trên S3`, { cause: error });
      }
      if (hasErrorName(error, UPLOAD_INCOMPLETE_ERROR_NAMES)) {
        throw new UploadIncompleteError(`Danh sách phần của ${key} không khớp`, { cause: error });
      }
      throw error;
    }
  }

  async getObjectSizeBytes(key: string): Promise<number> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (response.ContentLength === undefined) throw new Error(`S3 không trả về dung lượng của ${key}`);
      return response.ContentLength;
    } catch (error) {
      if (hasErrorName(error, OBJECT_NOT_FOUND_ERROR_NAMES)) {
        throw new ObjectNotFoundError(`Không thấy ${key} trên S3`, { cause: error });
      }
      throw error;
    }
  }

  async getObject(key: string): Promise<Readable> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!(response.Body instanceof Readable)) throw new Error(`S3 không trả về nội dung của ${key}`);
      return response.Body;
    } catch (error) {
      if (hasErrorName(error, OBJECT_NOT_FOUND_ERROR_NAMES)) {
        throw new ObjectNotFoundError(`Không thấy ${key} trên S3`, { cause: error });
      }
      throw error;
    }
  }

  async putObject({ key, body, contentType, cacheControl }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }
}
