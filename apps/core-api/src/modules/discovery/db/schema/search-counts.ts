import { sql } from 'drizzle-orm';
import { doublePrecision, index, primaryKey, text } from 'drizzle-orm/pg-core';
import { discoverySchema } from './discovery-schema.js';

/**
 * Mọi bộ đếm của chỉ mục tìm khám phá trong một bảng, phân theo `ns` (xem NS trong search/domain/explore/stats.ts):
 * df chung và từng nhánh, số tài liệu, độ dài, n-gram cho độ dính cụm, tên đường, chuỗi, tâm toạ độ mỗi nơi.
 * Dựng lại cùng transaction với search_documents.
 */
export const searchCounts = discoverySchema.table(
  'search_counts',
  {
    ns: text('ns').notNull(),
    key: text('key').notNull(),
    n: doublePrecision('n').notNull(),
  },
  (t) => [
    primaryKey({ name: 'search_counts_pkey', columns: [t.ns, t.key] }),
    // typoPool: từ df cùng chữ đầu, trong khoảng độ dài; không có index này thì quét mọi dòng df mỗi lần sửa lỗi gõ.
    index('idx_search_counts_df_first_len')
      .on(sql`left(${t.key}, 1)`, sql`length(${t.key})`)
      .where(sql`${t.ns} = 'df'`),
  ],
);
