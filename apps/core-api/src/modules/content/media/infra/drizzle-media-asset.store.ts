import type { Db } from '@tripflix/db';
import { OutboxWriter } from '@tripflix/outbox';
import { and, eq, sql } from 'drizzle-orm';
import { contentOutboxEvents, mediaAssets } from '../../db/schema/index.js';
import type {
  MediaAssetStatus,
  MediaAssetStore,
  MediaOutbox,
  NewUploadingAsset,
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
}
