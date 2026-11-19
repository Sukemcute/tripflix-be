import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';

export type PartStatus =
  | 'pending'
  | 'checking'
  | 'waiting'
  | 'deferred'
  | 'passed'
  | 'flagged'
  | 'failed'
  | 'not_applicable'
  | 'superseded';
export interface PartVerdict {
  id: string;
  status: 'passed' | 'flagged' | 'error';
  categories: Record<string, boolean>;
  scores: Record<string, number>;
  model: string | null;
  errorCode: string | null;
}
export const moderationParts = contentSchema.table(
  'moderation_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    contentVersion: text('content_version').notNull(),
    partKey: text('part_key').notNull(),
    kind: varchar('kind', { length: 10 }).$type<'caption' | 'image'>().notNull(),
    assetId: uuid('asset_id'),
    inputHash: text('input_hash').notNull(),
    policyVersion: text('policy_version').notNull(),
    status: varchar('status', { length: 20 }).$type<PartStatus>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    verdict: jsonb('verdict').$type<PartVerdict>(),
    errorCode: text('error_code'),
    retriedBy: uuid('retried_by'),
    retriedAt: timestamp('retried_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_moderation_parts_input').on(
      t.postId,
      t.contentVersion,
      t.partKey,
      t.inputHash,
      t.policyVersion,
    ),
    index('idx_moderation_parts_post').on(t.postId, t.contentVersion),
    index('idx_moderation_parts_due')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN ('pending', 'waiting', 'deferred', 'checking')`),
    check('ck_moderation_parts_kind', sql`${t.kind} IN ('caption', 'image')`),
    check(
      'ck_moderation_parts_status',
      sql`${t.status} IN ('pending','checking','waiting','deferred','passed','flagged','failed','not_applicable','superseded')`,
    ),
    check('ck_moderation_parts_attempts', sql`${t.attempts} BETWEEN 0 AND 8`),
  ],
);
