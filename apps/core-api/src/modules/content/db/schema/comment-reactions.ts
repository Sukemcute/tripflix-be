import { foreignKey, index, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { comments } from './comments.js';

export type CommentReactionType = 'like';

/**
 * Bảng comment_reactions: Quản lý cảm xúc (thả tim) của người dùng đối với từng bình luận (Idempotent).
 * Mỗi user chỉ có tối đa 1 cảm xúc trên 1 bình luận.
 * Schema: content
 */
export const commentReactions = contentSchema.table(
  'comment_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id').notNull(),
    userId: uuid('user_id').notNull(),
    type: varchar('type', { length: 20 }).$type<CommentReactionType>().notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_comment_reactions_comment_user').on(t.commentId, t.userId),
    index('idx_comment_reactions_user_created').on(t.userId, t.createdAt),
    foreignKey({
      name: 'fk_comment_reactions_comment_id',
      columns: [t.commentId],
      foreignColumns: [comments.id],
    }).onDelete('cascade'),
  ],
);

export type CommentReactionRecord = typeof commentReactions.$inferSelect;
export type NewCommentReactionRecord = typeof commentReactions.$inferInsert;
