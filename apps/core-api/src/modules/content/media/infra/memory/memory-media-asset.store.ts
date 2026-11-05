import type { EventEnvelope, MediaAspect, MediaQualityLevel } from '@tripflix/contracts';
import { buildEventEnvelope, type NewOutboxEvent } from '@tripflix/outbox';
import type {
  MediaAssetStatus,
  MediaAssetStore,
  NewUploadingAsset,
  PlaybackAsset,
  ReadyRendition,
  UploadTarget,
} from '../../application/ports.js';

type StoredAsset = NewUploadingAsset & {
  status: MediaAssetStatus;
  transcodeAttempts: number;
  hlsPrefix?: string;
  aspect?: MediaAspect;
  error?: string;
  levels: Set<MediaQualityLevel>;
};

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
    this.assets.set(asset.id, { ...asset, status: 'uploading', transcodeAttempts: 0, levels: new Set() });
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

  findStatus(assetId: string): Promise<MediaAssetStatus | null> {
    return Promise.resolve(this.assets.get(assetId)?.status ?? null);
  }

  insertRendition(assetId: string, level: MediaQualityLevel): Promise<void> {
    this.assets.get(assetId)?.levels.add(level);
    return Promise.resolve();
  }

  hasRendition(assetId: string, level: MediaQualityLevel): Promise<boolean> {
    return Promise.resolve(this.assets.get(assetId)?.levels.has(level) ?? false);
  }

  markReady({ assetId, hlsPrefix, durationSec, aspect }: ReadyRendition): Promise<string | null> {
    const asset = this.assets.get(assetId);
    if (asset?.status !== 'processing') return Promise.resolve(null);
    Object.assign(asset, { status: 'ready', hlsPrefix, durationSec, aspect });
    return Promise.resolve(asset.ownerId);
  }

  markFailed(assetId: string, reason: string): Promise<string | null> {
    const asset = this.assets.get(assetId);
    if (asset?.status !== 'processing') return Promise.resolve(null);
    Object.assign(asset, { status: 'failed', error: reason });
    return Promise.resolve(asset.ownerId);
  }

  recordError(assetId: string, reason: string): Promise<void> {
    const asset = this.assets.get(assetId);
    if (asset) asset.error = reason;
    return Promise.resolve();
  }

  findPlaybackAssets(assetIds: string[]): Promise<PlaybackAsset[]> {
    const readyAssets = assetIds.flatMap((id) => {
      const asset = this.assets.get(id);
      return asset?.status === 'ready' ? [asset] : [];
    });
    return Promise.resolve(
      readyAssets.map((asset) => ({
        id: asset.id,
        hlsPrefix: asset.hlsPrefix!,
        durationSec: asset.durationSec,
        aspect: asset.aspect!,
        levels: [...asset.levels].sort((a, b) => a - b),
      })),
    );
  }
}
