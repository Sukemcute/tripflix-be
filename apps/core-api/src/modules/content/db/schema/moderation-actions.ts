import {
  index,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './base.js';
import { posts, type PostStatus } from './posts.js';

export type ModerationActionType = 'hide' | 'remove' | 'restore';

/**
 * Bảng moderation_actions: Nhật ký kiểm toán thao tác kiểm duyệt trên bài đăng (Audit Trail).
 * Schema: content
 */
export const moderationActions = contentSchema.table(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    moderatorId: uuid('moderator_id').notNull(),
    action: varchar('action', { length: 20 }).$type<ModerationActionType>().notNull(),
    previousStatus: varchar('previous_status', { length: 20 }).$type<PostStatus>().notNull(),
    postStatus: varchar('post_status', { length: 20 }).$type<PostStatus>().notNull(),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reasonDetail: text('reason_detail'),
    reportIds: jsonb('report_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_moderation_post_created').on(t.postId, t.createdAt),
    index('idx_moderation_moderator').on(t.moderatorId),
  ],
);

export type ModerationActionRecord = typeof moderationActions.$inferSelect;
export type NewModerationActionRecord = typeof moderationActions.$inferInsert;
