import type { EventEnvelope } from '@tripflix/contracts';
import { buildEventEnvelope, type NewOutboxEvent } from '@tripflix/outbox';
import type {
  MediaAssetStatus,
  MediaAssetStore,
  NewUploadingAsset,
  UploadTarget,
} from '../../application/ports.js';

type StoredAsset = NewUploadingAsset & { status: MediaAssetStatus; transcodeAttempts: number };

/** Cùng quy tắc với DrizzleMediaAssetStore, lưu trong bộ nhớ, dùng cho test. Không có rollback. */
export class MemoryMediaAssetStore implements MediaAssetStore {
  readonly assets = new Map<string, StoredAsset>();
  readonly outboxRows: EventEnvelope[] = [];

  readonly outbox = {
    add: (event: NewOutboxEvent): Promise<string> => {
      const envelope = buildEventEnvelope(event, 'core-api/content');
      this.outboxRows.push(envelope);
      return Promise.resolve(envelope.eventId);
    },
  };

  insertUploadingAsset(asset: NewUploadingAsset): Promise<void> {
    this.assets.set(asset.id, { ...asset, status: 'uploading', transcodeAttempts: 0 });
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

  markProcessing(assetId: string): Promise<number | null> {
    const asset = this.assets.get(assetId);
    if (asset?.status !== 'uploading') return Promise.resolve(null);
    asset.status = 'processing';
    asset.transcodeAttempts += 1;
    return Promise.resolve(asset.transcodeAttempts);
  }
}
