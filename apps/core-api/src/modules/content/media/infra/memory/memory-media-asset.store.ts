import type {
  MediaAssetStatus,
  MediaAssetStore,
  NewUploadingAsset,
  UploadTarget,
} from '../../application/ports.js';

type StoredAsset = NewUploadingAsset & { status: MediaAssetStatus };

/** Cùng quy tắc với DrizzleMediaAssetStore, lưu trong bộ nhớ, dùng cho test. */
export class MemoryMediaAssetStore implements MediaAssetStore {
  readonly assets = new Map<string, StoredAsset>();

  insertUploadingAsset(asset: NewUploadingAsset): Promise<void> {
    this.assets.set(asset.id, { ...asset, status: 'uploading' });
    return Promise.resolve();
  }

  findUploadTarget(assetId: string, ownerId: string): Promise<UploadTarget | null> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.ownerId !== ownerId) return Promise.resolve(null);
    return Promise.resolve({
      id: asset.id,
      status: asset.status,
      fileSizeBytes: asset.fileSizeBytes,
      sourceKey: asset.sourceKey,
      s3UploadId: asset.s3UploadId,
    });
  }
}
