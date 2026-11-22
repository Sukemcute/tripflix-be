import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { TrendSignalKind } from '../../feed/domain/trend-signal.js';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng trend_signals (feed, TF111): lượt xem đủ và lượt bấm đặt lấy từ stream:app-events, để job tính điểm Hot
 * có thời điểm của từng tín hiệu (bán rã 48 giờ). Mỗi người một dòng cho mỗi loại trên mỗi bài; dòng quá 30 ngày bị xoá.
 * Schema: content
 */
export const trendSignals = contentSchema.table(
  'trend_signals',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<TrendSignalKind>().notNull(),
    /** `u:<userId>` hoặc `a:<anonId>`. */
    actorKey: text('actor_key').notNull(),
    isGuest: boolean('is_guest').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_trend_signals_post_kind_actor').on(t.postId, t.kind, t.actorKey),
    index('idx_trend_signals_occurred_at').on(t.occurredAt),
    check('ck_trend_signals_kind', sql`${t.kind} in ('view', 'booking_click')`),
  ],
);

export type TrendSignalRecord = typeof trendSignals.$inferSelect;
