import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, integer, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';

/**
 * Video do người dùng tải lên. owner_id trỏ sang access.users nhưng không đặt khoá ngoại vì khác schema.
 * s3_upload_id để trống được: video mẫu nạp sẵn không đi qua upload nhiều phần.
 */
export const mediaAssets = contentSchema.table(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    status: text('status').notNull().default('uploading'),
    mimeType: text('mime_type').notNull(),
    // Lưu lúc xin link để đối chiếu với file thật khi hoàn tất upload.
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    sourceKey: text('source_key').notNull(),
    s3UploadId: text('s3_upload_id'),
    // Có số phiên bản r{n}: chuyển mã lại phải ghi sang thư mục mới vì CDN cache 1 năm.
    hlsPrefix: text('hls_prefix'),
    // Ban đầu là số app khai, worker ghi đè bằng thời lượng thật.
    durationSec: integer('duration_sec').notNull(),
    aspect: text('aspect'),
    transcodeAttempts: integer('transcode_attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_media_assets_status', sql`${t.status} in ('uploading', 'processing', 'ready', 'failed')`),
    check('ck_media_assets_mime_type', sql`${t.mimeType} in ('video/mp4', 'video/quicktime')`),
    check('ck_media_assets_aspect', sql`${t.aspect} in ('9:16', '16:9', '1:1')`),
    check('ck_media_assets_file_size_bytes', sql`${t.fileSizeBytes} > 0`),
    check('ck_media_assets_duration_sec', sql`${t.durationSec} > 0`),
    check('ck_media_assets_transcode_attempts', sql`${t.transcodeAttempts} >= 0`),
    // Feed đọc video ready để phát, nên trạng thái này phải đủ thông tin phát.
    check(
      'ck_media_assets_ready_has_playback',
      sql`${t.status} <> 'ready' or (${t.hlsPrefix} is not null and ${t.aspect} is not null)`,
    ),
  ],
);

/** Mỗi mức chất lượng đã xong một dòng. Khoá chính loại trùng khi worker báo lại cùng một mức. */
export const renditions = contentSchema.table(
  'renditions',
  {
    assetId: uuid('asset_id').notNull(),
    level: smallint('level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_renditions', columns: [t.assetId, t.level] }),
    foreignKey({ name: 'fk_renditions_asset_id', columns: [t.assetId], foreignColumns: [mediaAssets.id] }).onDelete(
      'cascade',
    ),
    check('ck_renditions_level', sql`${t.level} in (360, 540, 720)`),
  ],
);
