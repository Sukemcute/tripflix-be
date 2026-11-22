import { sql } from 'drizzle-orm';
import { doublePrecision, index, integer, jsonb, text } from 'drizzle-orm/pg-core';
import type { IndexedDoc } from '../../search/domain/explore/types.js';
import { discoverySchema } from './discovery-schema.js';

/**
 * Chỉ mục tìm khám phá: một dòng một thứ tìm được (khách sạn, bài, video) trong một nhánh.
 * Bản chép dựng lại được từ listCatalog + listPosts (job dựng lại toàn bộ), không phải nguồn sự thật.
 * Các cột riêng chỉ để lấy ứng viên bằng SQL; chấm điểm đọc `doc`.
 */
export const searchDocuments = discoverySchema.table(
  'search_documents',
  {
    id: text('id').primaryKey(),
    vertical: text('vertical').notNull(),
    // Thứ tự thêm vào chỉ mục: giữ kết quả ổn định khi bằng điểm.
    ord: integer('ord').notNull(),
    place: text('place'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    days: integer('days'),
    tier: text('tier'),
    // Các từ trong tf (đã chuẩn hoá) và tên đường trong địa chỉ.
    terms: text('terms').array().notNull(),
    streets: text('streets').array().notNull(),
    doc: jsonb('doc').$type<IndexedDoc>().notNull(),
  },
  (t) => [
    index('idx_search_documents_vertical_ord').on(t.vertical, t.ord),
    index('idx_search_documents_terms').using('gin', t.terms),
    index('idx_search_documents_streets').using('gin', t.streets),
    index('idx_search_documents_place').on(t.place),
    index('idx_search_documents_lat').on(t.lat).where(sql`${t.lat} is not null`),
  ],
);

export type SearchDocumentRow = typeof searchDocuments.$inferSelect;
