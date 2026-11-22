import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { createDb, createPool, type Db } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { deleteExpiredCommerceIdempotencyBatch } from './booking/jobs/commerce-cleanup.job.js';
import { commerceIdempotencyKeys } from './db/schema/index.js';

describe('Commerce cleanup trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('commerce');
    await migrateModule({
      url,
      module: 'commerce',
      migrationsFolder: fileURLToPath(new URL('./db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 5, applicationName: 'commerce-cleanup-int' });
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('chỉ xoá khoá hết hạn theo từng lô, giữ khoá tại đúng mốc thời gian', async () => {
    const before = new Date('2026-11-12T10:30:00.000Z');
    const expiredAt = new Date(before.getTime() - 1);
    await db.insert(commerceIdempotencyKeys).values([
      { scope: 'expired-a', key: 'shared', requestHash: 'hash-a', status: 'completed', expiresAt: expiredAt },
      { scope: 'expired-b', key: 'shared', requestHash: 'hash-b', status: 'completed', expiresAt: expiredAt },
      { scope: 'expired-c', key: 'other', requestHash: 'hash-c', status: 'completed', expiresAt: expiredAt },
      { scope: 'valid', key: 'shared', requestHash: 'hash-valid', status: 'completed', expiresAt: before },
    ]);

    expect(await deleteExpiredCommerceIdempotencyBatch(db, before, 2)).toBe(2);
    expect(await deleteExpiredCommerceIdempotencyBatch(db, before, 2)).toBe(1);
    expect(await deleteExpiredCommerceIdempotencyBatch(db, before, 2)).toBe(0);
    expect(
      await db
        .select({ scope: commerceIdempotencyKeys.scope, key: commerceIdempotencyKeys.key })
        .from(commerceIdempotencyKeys),
    ).toEqual([{ scope: 'valid', key: 'shared' }]);
  });
});
