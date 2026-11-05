import {
  index,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng bookmarks: Quản lý bài đăng được người dùng đánh dấu lưu.
 * Schema: content
 */
export const bookmarks = contentSchema.table(
  'bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_bookmarks_post_user').on(t.postId, t.userId),
    index('idx_bookmarks_user_created').on(t.userId, t.createdAt),
  ],
);

export type BookmarkRecord = typeof bookmarks.$inferSelect;
export type NewBookmarkRecord = typeof bookmarks.$inferInsert;
