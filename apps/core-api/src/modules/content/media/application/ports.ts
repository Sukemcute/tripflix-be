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

export interface MediaAssetStore {
  insertUploadingAsset(asset: NewUploadingAsset): Promise<void>;
  /** Chỉ trả về video của đúng chủ, nên video của người khác cũng giống như không tồn tại. */
  findUploadTarget(assetId: string, ownerId: string): Promise<UploadTarget | null>;
}
