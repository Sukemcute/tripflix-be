import type { MediaAspect, MediaQualityLevel } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { OutboxWriter } from '@tripflix/outbox';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { contentOutboxEvents, mediaAssets, renditions } from '../../db/schema/index.js';
import type {
  MediaAssetStatus,
  MediaAssetStore,
  MediaOutbox,
  NewUploadingAsset,
  PlaybackAsset,
  ReadyRendition,
  UploadTarget,
} from '../application/ports.js';

const CONTENT_EVENT_PRODUCER = 'core-api/content';

export class DrizzleMediaAssetStore implements MediaAssetStore {
  readonly outbox: MediaOutbox;

  constructor(private readonly getDb: () => Db) {
    this.outbox = new OutboxWriter(getDb, contentOutboxEvents, CONTENT_EVENT_PRODUCER);
  }

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async insertUploadingAsset(asset: NewUploadingAsset): Promise<void> {
    await this.db.insert(mediaAssets).values(asset);
  }

  async findUploadTarget(assetId: string, ownerId: string): Promise<UploadTarget | null> {
    const [row] = await this.db
      .select({
        id: mediaAssets.id,
        status: mediaAssets.status,
        fileSizeBytes: mediaAssets.fileSizeBytes,
        sourceKey: mediaAssets.sourceKey,
        s3UploadId: mediaAssets.s3UploadId,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerId, ownerId)));
    return row ? { ...row, status: row.status as MediaAssetStatus } : null;
  }

  async markProcessing(assetId: string): Promise<number | null> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({
        status: 'processing',
        transcodeAttempts: sql`${mediaAssets.transcodeAttempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'uploading')))
      .returning({ transcodeAttempts: mediaAssets.transcodeAttempts });
    return row?.transcodeAttempts ?? null;
  }

  async findStatus(assetId: string): Promise<MediaAssetStatus | null> {
    const [row] = await this.db.select({ status: mediaAssets.status }).from(mediaAssets).where(eq(mediaAssets.id, assetId));
    return row ? (row.status as MediaAssetStatus) : null;
  }

  async insertRendition(assetId: string, level: MediaQualityLevel): Promise<void> {
    await this.db.insert(renditions).values({ assetId, level }).onConflictDoNothing();
  }

  async hasRendition(assetId: string, level: MediaQualityLevel): Promise<boolean> {
    const [row] = await this.db
      .select({ level: renditions.level })
      .from(renditions)
      .where(and(eq(renditions.assetId, assetId), eq(renditions.level, level)));
    return row !== undefined;
  }

  async markReady({ assetId, hlsPrefix, durationSec, aspect }: ReadyRendition): Promise<string | null> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({ status: 'ready', hlsPrefix, durationSec, aspect, updatedAt: sql`now()` })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'processing')))
      .returning({ ownerId: mediaAssets.ownerId });
    return row?.ownerId ?? null;
  }

  async markFailed(assetId: string, reason: string): Promise<string | null> {
    const [row] = await this.db
      .update(mediaAssets)
      .set({ status: 'failed', error: reason, updatedAt: sql`now()` })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'processing')))
      .returning({ ownerId: mediaAssets.ownerId });
    return row?.ownerId ?? null;
  }

  async recordError(assetId: string, reason: string): Promise<void> {
    await this.db.update(mediaAssets).set({ error: reason, updatedAt: sql`now()` }).where(eq(mediaAssets.id, assetId));
  }

  async findPlaybackAssets(assetIds: string[]): Promise<PlaybackAsset[]> {
    if (assetIds.length === 0) return [];
    const assets = await this.db
      .select({
        id: mediaAssets.id,
        hlsPrefix: mediaAssets.hlsPrefix,
        durationSec: mediaAssets.durationSec,
        aspect: mediaAssets.aspect,
      })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.status, 'ready')));
    if (assets.length === 0) return [];
    const levelRows = await this.db
      .select({ assetId: renditions.assetId, level: renditions.level })
      .from(renditions)
      .where(inArray(renditions.assetId, assets.map((asset) => asset.id)))
      .orderBy(renditions.level);
    return assets.flatMap((asset) => {
      const levels = levelRows.filter((row) => row.assetId === asset.id).map((row) => row.level as MediaQualityLevel);
      // Video do worker làm luôn có mức 360p. Không có mức nào nghĩa là dữ liệu nạp tay, chưa chắc có file trên CDN.
      if (levels.length === 0) return [];
      return [
        {
          id: asset.id,
          // Ràng buộc ck_media_assets_ready_has_playback bảo đảm video ready có đủ hai cột này.
          hlsPrefix: asset.hlsPrefix!,
          aspect: asset.aspect as MediaAspect,
          durationSec: asset.durationSec,
          levels,
        },
      ];
    });
  }
}
