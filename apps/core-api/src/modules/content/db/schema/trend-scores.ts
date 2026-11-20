import { bigint, doublePrecision, index, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng trend_scores (feed, TF111, docs/10): điểm Hot của bài video đăng trong 30 ngày, job ghi lại cả bảng mỗi 5 phút.
 * Tab "Đang hot" và discovery (qua FeedFacade) đọc từ đây; bài ẩn hay riêng tư vẫn bị lọc lúc đọc theo posts.status.
 * Schema: content
 */
export const trendScores = contentSchema.table(
  'trend_scores',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** Điểm đã chuẩn hoá theo p99 của lô, trong [0, 1]. */
    score: doublePrecision('score').notNull(),
    /** log10(1 + tín hiệu sau bán rã) × hệ số hoàn thiện, trước khi chuẩn hoá. */
    raw: doublePrecision('raw').notNull(),
    /** Σ trọng số × 0,5^(tuổi / 48h), để soi vì sao bài lên hay xuống. */
    decayedSignal: doublePrecision('decayed_signal').notNull(),
    completeness: doublePrecision('completeness').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_trend_scores_post_id').on(t.postId),
    index('idx_trend_scores_score').on(t.score.desc(), t.postId),
  ],
);

export type TrendScoreRecord = typeof trendScores.$inferSelect;
