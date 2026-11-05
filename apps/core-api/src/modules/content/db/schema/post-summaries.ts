import { integer, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng post_summaries: Lưu kết quả tóm tắt nội dung & thảo luận bài viết từ phân hệ AI.
 * Schema: content
 */
export const postSummaries = contentSchema.table('post_summaries', {
  postId: uuid('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  keyTakeaways: jsonb('key_takeaways').$type<string[]>().default([]).notNull(),
  inputHash: varchar('input_hash', { length: 128 }),
  commentCountAtSummary: integer('comment_count_at_summary').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PostSummaryRecord = typeof postSummaries.$inferSelect;
export type NewPostSummaryRecord = typeof postSummaries.$inferInsert;
