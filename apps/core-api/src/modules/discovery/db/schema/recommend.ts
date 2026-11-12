import { boolean, doublePrecision, index, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { discoverySchema } from './discovery-schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Bảng thô của gợi ý: mọi sự kiện tương tác thành 0..n dòng (đề xuất recommend-offline mục 3.4, 4).
 * ref_id quyết định ghi đè (trạng thái, vd ref = postId) hay thêm mới (ref = eventId).
 * Upsert chỉ ghi đè khi occurred_at mới hơn: sự kiện giao lại không ghi đôi, sự kiện cũ đến sau không đè.
 */
export const recommendInteractions = discoverySchema.table(
  'recommend_interactions',
  {
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    kind: text('kind').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    refId: text('ref_id').notNull(),
    value: doublePrecision('value'),
    isRemoved: boolean('is_removed').notNull().default(false),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    occurredAt: at('occurred_at').notNull(),
    source: text('source').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    ingestedAt: at('ingested_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'recommend_interactions_pkey', columns: [t.actorType, t.actorId, t.kind, t.refId] }),
    index('idx_recommend_interactions_ingested_at').on(t.ingestedAt),
    index('idx_recommend_interactions_kind_occurred_at').on(t.kind, t.occurredAt),
  ],
);

/** Metadata bài đang hiện công khai, chép từ content.listPosts mỗi chu kỳ job. Không phụ thuộc builder. */
export const recommendPosts = discoverySchema.table(
  'recommend_posts',
  {
    postId: uuid('post_id').primaryKey(),
    authorId: uuid('author_id').notNull(),
    postType: text('post_type').notNull(),
    tags: text('tags').array().notNull(),
    placeId: text('place_id'),
    isVerified: boolean('is_verified').notNull(),
    publishedAt: at('published_at').notNull(),
    syncedAt: at('synced_at').notNull().defaultNow(),
  },
  (t) => [index('idx_recommend_posts_published_at').on(t.publishedAt.desc())],
);

/** Điểm + đặc trưng bài, mỗi post builder (builder@version) một tập dòng. */
export const recommendPostScores = discoverySchema.table(
  'recommend_post_scores',
  {
    builder: text('builder').notNull(),
    version: text('version').notNull(),
    postId: uuid('post_id').notNull(),
    postType: text('post_type').notNull(),
    score: doublePrecision('score').notNull(),
    features: jsonb('features').$type<Record<string, unknown>>().notNull(),
    builtAt: at('built_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'recommend_post_scores_pkey', columns: [t.builder, t.version, t.postId] }),
    index('idx_recommend_post_scores_builder_version_post_type_score').on(t.builder, t.version, t.postType, t.score.desc()),
  ],
);

/** Đặc trưng người dùng, mỗi user builder một tập dòng. */
export const recommendUserFeatures = discoverySchema.table(
  'recommend_user_features',
  {
    builder: text('builder').notNull(),
    version: text('version').notNull(),
    userId: uuid('user_id').notNull(),
    features: jsonb('features').$type<Record<string, unknown>>().notNull(),
    builtAt: at('built_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'recommend_user_features_pkey', columns: [t.builder, t.version, t.userId] })],
);

/** Thuật toán đang bật cho mỗi mode: bộ ba post_builder + user_builder + ranker. Đổi dòng = đổi thuật toán, không deploy. */
export const recommendAlgos = discoverySchema.table('recommend_algos', {
  name: text('name').primaryKey(),
  postBuilder: text('post_builder').notNull(),
  userBuilder: text('user_builder').notNull(),
  ranker: text('ranker').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

/** Mốc của bộ điều phối và từng builder (name = 'build-features' hoặc 'hot@v0'...). */
export const recommendJobState = discoverySchema.table('recommend_job_state', {
  name: text('name').primaryKey(),
  watermark: at('watermark'),
  lastRunAt: at('last_run_at'),
  lastError: text('last_error'),
});

export type RecommendInteractionRow = typeof recommendInteractions.$inferInsert;
