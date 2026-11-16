import { sql } from 'drizzle-orm';
import { date, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { discoverySchema } from './discovery-schema.js';

/**
 * Đếm n-gram (1–2 từ) của câu tìm theo ngày, để so với `ng` của chỉ mục (search/domain/explore/vocab-gaps.ts).
 * Không lưu người tìm. `samples`: tối đa 5 câu gốc mỗi n-gram mỗi ngày. Khoá `#q`, `#1`, `#2`: số câu, tổng unigram, tổng bigram.
 * Xoá sau 90 ngày (PurgeInteractionsJob).
 */
export const searchQueryGrams = discoverySchema.table(
  'search_query_grams',
  {
    day: date('day', { mode: 'string' }).notNull(),
    gram: text('gram').notNull(),
    hits: integer('hits').notNull(),
    samples: text('samples').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [primaryKey({ name: 'search_query_grams_pkey', columns: [t.day, t.gram] })],
);
