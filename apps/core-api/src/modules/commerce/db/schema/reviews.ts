import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, jsonb, smallint, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { commerceSchema } from './commerce-schema.js';
import { properties, roomTypes } from './catalog.js';

/**
 * Đánh giá khách sạn của khách. Đánh giá thật gắn với booking đã ở (mỗi booking một đánh giá); dữ liệu demo do seed
 * nạp có is_seeded = true và không có booking. user_id trỏ sang access.users nhưng không đặt khoá ngoại vì khác database.
 * images lưu khoá trên kho media như ảnh khách sạn.
 */
export const reviews = commerceSchema.table(
  'reviews',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id').notNull(),
    roomTypeId: text('room_type_id'),
    bookingId: text('booking_id'),
    userId: uuid('user_id'),
    authorName: text('author_name').notNull(),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    // family | couple | solo | business | friends
    travelerType: text('traveler_type'),
    stayMonth: date('stay_month', { mode: 'string' }),
    helpfulCount: integer('helpful_count').notNull().default(0),
    // published | hidden: ẩn khi kiểm duyệt, không xoá.
    status: text('status').notNull().default('published'),
    isSeeded: boolean('is_seeded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_reviews_property_id', columns: [t.propertyId], foreignColumns: [properties.id] }),
    foreignKey({ name: 'fk_reviews_room_type_id', columns: [t.roomTypeId], foreignColumns: [roomTypes.id] }),
    index('idx_reviews_property_id_created_at').on(t.propertyId, t.createdAt),
    uniqueIndex('uq_reviews_booking_id').on(t.bookingId),
    check('ck_reviews_rating', sql`${t.rating} between 1 and 5`),
    check('ck_reviews_status', sql`${t.status} in ('published', 'hidden')`),
    check('ck_reviews_helpful_count', sql`${t.helpfulCount} >= 0`),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
