import { sql } from 'drizzle-orm';
import { check, index, jsonb, smallint, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import type { TripItineraryItem } from './posts.js';

/** Điểm của lộ trình đã lưu: cùng dạng điểm của reel, thêm buổi, toạ độ, mã địa điểm (Tripi) và số đêm (khách sạn). */
export interface SavedItineraryItemData extends TripItineraryItem {
  slot?: 'sáng' | 'trưa' | 'chiều' | 'tối';
  lat?: number;
  lng?: number;
  placeId?: string;
  nights?: number;
}

/**
 * Lộ trình khách lưu (TF105): bản sao theo Ngày 1..N, khách sửa được; không ngày thật, không giá.
 * source_post_id giữ link về reel gốc; không khoá ngoại để reel bị xoá thì lộ trình của khách vẫn còn.
 */
export const savedItineraries = contentSchema.table(
  'saved_itineraries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    destinationName: varchar('destination_name', { length: 120 }),
    destinationPlaceId: varchar('destination_place_id', { length: 100 }),
    daysCount: smallint('days_count').notNull(),
    items: jsonb('items').$type<SavedItineraryItemData[]>().notNull(),
    source: varchar('source', { length: 10 }).$type<'reel' | 'tripi' | 'builder'>().notNull(),
    sourcePostId: uuid('source_post_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_saved_itineraries_user_updated').on(t.userId, t.updatedAt),
    // Mỗi reel chỉ lưu một lần mỗi người: bấm Lưu lại không tạo bản trùng.
    uniqueIndex('uq_saved_itineraries_user_post').on(t.userId, t.sourcePostId).where(sql`${t.sourcePostId} is not null`),
    check('ck_saved_itineraries_source', sql`${t.source} in ('reel', 'tripi', 'builder')`),
    check('ck_saved_itineraries_days', sql`${t.daysCount} between 1 and 14`),
  ],
);

export type SavedItineraryRecord = typeof savedItineraries.$inferSelect;
