import {
  index,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './base.js';
import { posts } from './posts.js';

export type ReactionType = 'like' | 'love' | 'helpful';

/**
 * Bảng reactions: Quản lý cảm xúc của người dùng đối với bài đăng (Idempotent).
 * Mỗi user chỉ có tối đa 1 cảm xúc trên 1 bài đăng.
 * Schema: content
 */
export const reactions = contentSchema.table(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    type: varchar('type', { length: 20 }).$type<ReactionType>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_reactions_post_user').on(t.postId, t.userId),
    index('idx_reactions_post_type').on(t.postId, t.type),
    index('idx_reactions_user_created').on(t.userId, t.createdAt),
  ],
);

export type ReactionRecord = typeof reactions.$inferSelect;
export type NewReactionRecord = typeof reactions.$inferInsert;
