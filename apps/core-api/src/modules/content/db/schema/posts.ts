import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';

export type PostType = 'video' | 'vlog';
export type PostStatus = 'draft' | 'published' | 'hidden' | 'removed' | 'deleted';
export type PostVisibility = 'public' | 'private';

export interface TripItineraryItem {
  day: number;
  title: string;
  location?: string;
  notes?: string;
  transport?: {
    mode: 'flight' | 'bus' | 'train' | 'car' | 'other';
    fromAirport?: string;
    toAirport?: string;
  };
}

export interface TripAttachmentData {
  bookingId?: string;
  hotelId?: string;
  hotelName?: string;
  destinationName?: string;
  daysCount?: number;
  estimatedCostPerPerson?: number;
  priceDisclaimer?: string;
  items?: TripItineraryItem[];
}

/**
 * Bảng posts: Quản lý bài đăng reels/video ngắn và vlog của thành viên.
 * Schema: content
 */
export const posts = contentSchema.table(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id').notNull(),
    postType: varchar('post_type', { length: 20 }).$type<PostType>().notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull().default(''),
    hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).$type<PostStatus>().notNull().default('draft'),
    visibility: varchar('visibility', { length: 20 }).$type<PostVisibility>().notNull().default('public'),
    isVerified: boolean('is_verified').notNull().default(false),
    mediaIds: jsonb('media_ids').$type<string[]>().notNull().default([]),
    coverMediaId: uuid('cover_media_id'),
    tripAttachment: jsonb('trip_attachment').$type<TripAttachmentData | null>(),
    reactionCounts: jsonb('reaction_counts').$type<Record<string, number>>().notNull().default({}),
    reactionTotal: integer('reaction_total').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    shareCount: integer('share_count').notNull().default(0),
    bookmarkCount: integer('bookmark_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_posts_status_visibility_created').on(t.status, t.visibility, t.createdAt),
    index('idx_posts_author_created').on(t.authorId, t.createdAt),
    index('idx_posts_author_status').on(t.authorId, t.status),
  ],
);

export type PostRecord = typeof posts.$inferSelect;
export type NewPostRecord = typeof posts.$inferInsert;
