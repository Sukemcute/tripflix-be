import { foreignKey, integer, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

/**
 * Bảng post_summaries: Lưu kết quả tóm tắt nội dung & thảo luận bài viết từ phân hệ AI.
 * Schema: content
 */
export const postSummaries = contentSchema.table(
  'post_summaries',
  {
    postId: uuid('post_id').primaryKey(),
    status: varchar('status', { length: 32 }).notNull().default('ready'),
    summary: text('summary'),
    keyTakeaways: jsonb('key_takeaways').$type<string[]>().default([]).notNull(),
    content: jsonb('content'),
    safety: jsonb('safety'),
    inputHash: varchar('input_hash', { length: 128 }),
    commentCountAtSummary: integer('comment_count_at_summary').notNull().default(0),
    promptVersion: varchar('prompt_version', { length: 32 }),
    modelName: varchar('model_name', { length: 64 }),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'fk_post_summaries_post_id',
      columns: [t.postId],
      foreignColumns: [posts.id],
    }).onDelete('cascade'),
  ],
);

export type PostSummaryRecord = typeof postSummaries.$inferSelect;
export type NewPostSummaryRecord = typeof postSummaries.$inferInsert;
