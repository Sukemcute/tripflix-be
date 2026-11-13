import { index, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts, type PostStatus } from './posts.js';
import type { ModerationTarget } from './moderation.js';

export type ModerationActionType = 'hide' | 'remove' | 'restore';
export type ContentModerationActionType = ModerationActionType | 'auto_hide' | 'dismiss';

/**
 * Bảng moderation_actions: Nhật ký kiểm toán thao tác kiểm duyệt trên bài đăng (Audit Trail).
 * Schema: content
 */
export const moderationActions = contentSchema.table(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    targetType: varchar('target_type', { length: 20 }).$type<ModerationTarget>().notNull().default('post'),
    commentId: uuid('comment_id'),
    actorType: varchar('actor_type', { length: 20 }).$type<'staff' | 'system'>().notNull().default('staff'),
    caseId: uuid('case_id'),
    moderatorId: uuid('moderator_id').notNull(),
    action: varchar('action', { length: 20 }).$type<ContentModerationActionType>().notNull(),
    previousStatus: varchar('previous_status', { length: 20 }).$type<PostStatus | 'visible'>().notNull(),
    postStatus: varchar('post_status', { length: 20 }).$type<PostStatus | 'visible'>().notNull(),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reasonDetail: text('reason_detail'),
    contentVersion: text('content_version'),
    policyVersion: text('policy_version'),
    evidenceSnapshot: jsonb('evidence_snapshot').$type<{
      text: string;
      coverMediaId: string | null;
      mediaIds: string[];
    }>(),
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
