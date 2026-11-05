import type { NewOutboxEvent } from '@tripflix/outbox';
import type { MediaMimeType } from '../domain/upload-rules.js';

export const MEDIA_ASSET_STORE = Symbol('MEDIA_ASSET_STORE');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const MEDIA_CLOCK = Symbol('MEDIA_CLOCK');

export type MediaClock = () => Date;

export type MediaAssetStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface NewUploadingAsset {
  id: string;
  ownerId: string;
  mimeType: MediaMimeType;
  fileSizeBytes: number;
  sourceKey: string;
  s3UploadId: string;
  durationSec: number;
}

export interface UploadTarget {
  id: string;
  status: MediaAssetStatus;
  fileSizeBytes: number;
  sourceKey: string;
  s3UploadId: string | null;
}

export interface MediaOutbox {
  add(event: NewOutboxEvent): Promise<string>;
}

/** Transaction do @Transactional('content') ở use case mở, store tự dùng. */
export interface MediaAssetStore {
  outbox: MediaOutbox;
  insertUploadingAsset(asset: NewUploadingAsset): Promise<void>;
  /** Chỉ trả về video của đúng chủ, nên video của người khác cũng giống như không tồn tại. */
  findUploadTarget(assetId: string, ownerId: string): Promise<UploadTarget | null>;
  /**
   * Chuyển uploading sang processing và tăng số lần chuyển mã. Trả về số lần mới, dùng làm revision.
   * Trả null khi video không còn uploading, để hai lần gọi cùng lúc chỉ một lần được giao việc.
   */
  markProcessing(assetId: string): Promise<number | null>;
}
