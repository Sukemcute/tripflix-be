import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, jsonb, real, text, timestamp } from 'drizzle-orm/pg-core';
import { discoverySchema } from './discovery-schema.js';

/**
 * Cây nơi (tỉnh, điểm đến) của discovery: nguồn sự thật, ít ghi. id trùng provinceSlug của commerce.
 * Nạp từ hằng trong code lúc worker khởi động (LoadPlacesJob).
 */
export const places = discoverySchema.table(
  'places',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    parentId: text('parent_id'),
    aliases: text('aliases').array().notNull().default(sql`'{}'`),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_places_kind', sql`${t.kind} in ('province', 'destination')`),
    foreignKey({ name: 'fk_places_parent_id', columns: [t.parentId], foreignColumns: [t.id] }),
    index('idx_places_parent_id').on(t.parentId),
  ],
);

/**
 * Địa điểm ngoài OTA và social (PRD 0.3.1): điểm tham quan, quán ăn, quán nước, chỗ ở tham khảo. Không đặt được.
 * Nguồn mở (OSM, ODbL) nên phải ghi nguồn khi hiển thị. Ít ghi; `is_hidden` để gỡ điểm sai mà lần nạp sau không hiện lại.
 */
export const pointsOfInterest = discoverySchema.table(
  'points_of_interest',
  {
    id: text('id').primaryKey(),
    placeId: text('place_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    popularity: real('popularity').notNull().default(0),
    /** Thông tin ít dùng chưa cần cột (cuisine, opening_hours, website, địa chỉ). */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    source: text('source').notNull(),
    isHidden: boolean('is_hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_points_of_interest_kind', sql`${t.kind} in ('see', 'food', 'cafe', 'lodging')`),
    foreignKey({ name: 'fk_points_of_interest_place_id', columns: [t.placeId], foreignColumns: [places.id] }),
    index('idx_points_of_interest_place_id_kind').on(t.placeId, t.kind),
  ],
);

export type PlaceRow = typeof places.$inferSelect;
export type PointOfInterestRow = typeof pointsOfInterest.$inferSelect;
