import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { createIdempotencyKeysTable } from '@tripflix/idempotency';

export const contentIdempotencyKeys = createIdempotencyKeysTable(contentSchema);

export type ModerationTarget = 'post' | 'comment';
export const moderationCases = contentSchema.table(
  'moderation_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: varchar('target_type', { length: 20 }).$type<ModerationTarget>().notNull(),
    targetId: uuid('target_id').notNull(),
    postId: uuid('post_id').notNull(),
    authorId: uuid('author_id').notNull(),
    status: varchar('status', { length: 20 }).$type<'pending' | 'resolved'>().notNull().default('pending'),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    severity: integer('severity').notNull().default(0),
    flags: jsonb('flags').$type<Record<string, unknown>>().notNull().default({}),
    reportCount: integer('report_count').notNull().default(0),
    isAutoHidden: boolean('is_auto_hidden').notNull().default(false),
    resolution: varchar('resolution', { length: 20 }),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('ck_moderation_cases_target_type', sql`${t.targetType} IN ('post', 'comment')`),
    check('ck_moderation_cases_status', sql`${t.status} IN ('pending', 'resolved')`),
    check('ck_moderation_cases_severity', sql`${t.severity} BETWEEN 0 AND 100`),
    uniqueIndex('uq_moderation_cases_target_pending')
      .on(t.targetType, t.targetId)
      .where(sql`${t.status} = 'pending'`),
    index('idx_moderation_cases_queue').on(t.status, t.severity.desc(), t.createdAt),
  ],
);
export const reports = contentSchema.table(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: varchar('target_type', { length: 20 }).$type<ModerationTarget>().notNull(),
    targetId: uuid('target_id').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reasonDetail: text('reason_detail'),
    caseId: uuid('case_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({ name: 'fk_reports_case_id', columns: [t.caseId], foreignColumns: [moderationCases.id] }),
    check('ck_reports_target_type', sql`${t.targetType} IN ('post', 'comment')`),
    uniqueIndex('uq_reports_target_reporter').on(t.targetType, t.targetId, t.reporterId),
    index('idx_reports_target_created').on(t.targetType, t.targetId, t.createdAt),
  ],
);
export const moderationProcessedEvents = contentSchema.table(
  'moderation_processed_events',
  {
    consumerGroup: varchar('consumer_group', { length: 50 }).notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ name: 'pk_moderation_processed_events', columns: [t.consumerGroup, t.eventId] })],
);
export type ModerationCaseRecord = typeof moderationCases.$inferSelect;
