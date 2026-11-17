import { bigint, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng đệm số bình luận của bài đang đông (TF99): lượt thêm bình luận không lấy được khoá dòng bài ngay thì ghi
 * một dòng "+1" ở đây thay vì xếp hàng; job cộng dồn vào posts.comment_count rồi xoá, mỗi khoảng 1 giây.
 */
export const postCounterDeltas = contentSchema.table('post_counter_deltas', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  commentDelta: integer('comment_delta').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PostCounterDeltaRecord = typeof postCounterDeltas.$inferSelect;
