import { sql } from 'drizzle-orm';
import { check, index, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';

export const follows = contentSchema.table('follows', {
  followerId: uuid('follower_id').notNull(),
  authorId: uuid('author_id').notNull(),
  followedAt: timestamp('followed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'pk_follows', columns: [table.followerId, table.authorId] }),
  index('idx_follows_author_follower').on(table.authorId, table.followerId),
  check('ck_follows_distinct_users', sql`${table.followerId} <> ${table.authorId}`),
]);
