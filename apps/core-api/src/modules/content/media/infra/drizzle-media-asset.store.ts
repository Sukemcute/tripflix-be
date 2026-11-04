import type { Db } from '@tripflix/db';
import { and, eq } from 'drizzle-orm';
import { mediaAssets } from '../../db/schema/index.js';
import type {
  MediaAssetStatus,
  MediaAssetStore,
  NewUploadingAsset,
  UploadTarget,
} from '../application/ports.js';

export class DrizzleMediaAssetStore implements MediaAssetStore {
  constructor(private readonly db: Db) {}

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
}
