import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, primaryKey, text, timestamp, type PgSchema } from 'drizzle-orm/pg-core';

/**
 * Bảng idempotency_keys trong schema của module dùng (docs/architecture/10 §3.4).
 * Mỗi (scope, key) một dòng: scope = người dùng + method + đường dẫn, key = header Idempotency-Key.
 * Module khai báo trong db/schema: `export const commerceIdempotencyKeys = createIdempotencyKeysTable(commerceSchema)`.
 */
export function createIdempotencyKeysTable<TSchema extends string>(schema: PgSchema<TSchema>) {
  return schema.table(
    'idempotency_keys',
    {
      scope: text('scope').notNull(),
      key: text('key').notNull(),
      requestHash: text('request_hash').notNull(),
      status: text('status').notNull(),
      responseStatus: integer('response_status'),
      responseBody: jsonb('response_body'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      primaryKey({ name: 'pk_idempotency_keys', columns: [t.scope, t.key] }),
      check('ck_idempotency_keys_status', sql`${t.status} in ('processing', 'completed')`),
      index('idx_idempotency_keys_expires_at').on(t.expiresAt),
    ],
  );
}

export type IdempotencyKeysTable = ReturnType<typeof createIdempotencyKeysTable>;
