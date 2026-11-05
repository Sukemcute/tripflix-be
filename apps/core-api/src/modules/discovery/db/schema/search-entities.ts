import { sql } from 'drizzle-orm';
import { check, index, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { discoverySchema } from './discovery-schema.js';

/**
 * Chỉ mục gợi ý của ô tìm OTA: địa điểm, khách sạn, sân bay trong một bảng.
 * Là bản chép dựng lại được (từ cây địa điểm + commerce.listCatalog), không phải nguồn sự thật.
 */
export const searchEntities = discoverySchema.table(
  'search_entities',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    refId: text('ref_id').notNull(),
    name: text('name').notNull(),
    subtitle: text('subtitle'),
    placeId: text('place_id'),
    // Đã bỏ dấu, chữ thường (normalizeText); chỉ có [a-z0-9 ].
    searchText: text('search_text').notNull(),
    popularity: integer('popularity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_search_entities_type', sql`${t.type} in ('place', 'hotel', 'airport')`),
    index('idx_search_entities_search_text').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
);

export type SearchEntityRow = typeof searchEntities.$inferSelect;
