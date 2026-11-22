import { sql } from 'drizzle-orm';
import { index, integer, jsonb, text, timestamp, uuid, type PgSchema } from 'drizzle-orm/pg-core';

/**
 * Bảng outbox_events trong schema của module gọi hàm (docs/architecture/10 §3.3).
 * Module ghi sự kiện vào đây trong cùng transaction với thay đổi; relay đọc rồi XADD sang Redis Streams.
 * Mỗi module khai báo một lần trong db/schema của mình: `export const contentOutboxEvents = createOutboxTable(contentSchema)`.
 */
export function createOutboxTable<TSchema extends string>(schema: PgSchema<TSchema>) {
  return schema.table(
    'outbox_events',
    {
      // Chính là eventId trong phong bì sự kiện; consumer loại trùng theo giá trị này.
      id: uuid('id').primaryKey(),
      type: text('type').notNull(),
      version: integer('version').notNull(),
      producer: text('producer').notNull(),
      payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
      userId: uuid('user_id'),
      traceId: text('trace_id'),
      occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
      publishedAt: timestamp('published_at', { withTimezone: true }),
      attempts: integer('attempts').notNull().default(0),
      // Relay giành dòng tới mốc này; relay chết giữa chừng thì hết mốc là dòng được giành lại.
      lockedUntil: timestamp('locked_until', { withTimezone: true }),
      lastError: text('last_error'),
    },
    (t) => [index('idx_outbox_events_unpublished').on(t.occurredAt).where(sql`${t.publishedAt} is null`)],
  );
}

export type OutboxTable = ReturnType<typeof createOutboxTable>;
