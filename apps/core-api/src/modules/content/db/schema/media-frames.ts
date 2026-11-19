import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { MediaFramesCompletedV1 } from '@tripflix/contracts';
import { contentSchema } from './content-schema.js';
import { mediaAssets } from './media.js';

export const mediaFrameScans = contentSchema.table(
  'media_frame_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    sourceKey: text('source_key').notNull(),
    policy: text('policy').notNull(),
    requestId: uuid('request_id').notNull(),
    status: text('status').$type<'requested' | 'ready' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull().default(1),
    manifest: jsonb('manifest').$type<MediaFramesCompletedV1>(),
    errorCode: text('error_code'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    retriedBy: uuid('retried_by'),
    retriedAt: timestamp('retried_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_media_frame_scans_revision').on(t.assetId, t.revision, t.policy),
    index('idx_media_frame_scans_asset').on(t.assetId),
    check('ck_media_frame_scans_status', sql`${t.status} IN ('requested','ready','failed')`),
    check('ck_media_frame_scans_attempts', sql`${t.attempts} BETWEEN 1 AND 3`),
  ],
);
