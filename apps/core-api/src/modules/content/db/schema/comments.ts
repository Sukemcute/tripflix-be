import { boolean, check, index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';
import { sql } from 'drizzle-orm';

/**
 * Bảng comments: Quản lý bình luận và phản hồi (1-level reply) trên bài đăng.
 * Schema: content
 */
export const comments = contentSchema.table(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull(),
    parentCommentId: uuid('parent_comment_id'),
    body: text('body').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'visible' | 'hidden' | 'removed'>()
      .notNull()
      .default('visible'),
    hiddenByActionId: uuid('hidden_by_action_id'),
    cascadeRootCommentId: uuid('cascade_root_comment_id'),
    likeCount: integer('like_count').notNull().default(0),
    isEdited: boolean('is_edited').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_comments_status', sql`${t.status} IN ('visible', 'hidden', 'removed')`),
    index('idx_comments_post_created').on(t.postId, t.createdAt),
    index('idx_comments_parent').on(t.parentCommentId),
    index('idx_comments_author').on(t.authorId),
  ],
);

export type CommentRecord = typeof comments.$inferSelect;
export type NewCommentRecord = typeof comments.$inferInsert;
