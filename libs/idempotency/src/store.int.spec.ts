import { createDb, createPool } from '@tripflix/db';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import { pgSchema } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { DrizzleIdempotencyStore } from './store.js';
import { createIdempotencyKeysTable } from './table.js';

// Bảng thử trong schema riêng; DDL viết tay khớp createIdempotencyKeysTable (module thật sinh bằng db:generate).
const idempotencyKeys = createIdempotencyKeysTable(pgSchema('idem_test'));
const DDL = `
  create schema idem_test;
  create table idem_test.idempotency_keys (
    scope text not null, key text not null, request_hash text not null, status text not null,
    response_status integer, response_body jsonb,
    created_at timestamptz not null default now(), expires_at timestamptz not null,
    constraint pk_idempotency_keys primary key (scope, key),
    constraint ck_idempotency_keys_status check (status in ('processing', 'completed'))
  );`;

describe('DrizzleIdempotencyStore trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleIdempotencyStore;

  beforeAll(async () => {
    postgres = await startPostgres();
    pool = createPool({ url: postgres.buildAdminUrl('core'), max: 5, applicationName: 'idem-int-test' });
    await pool.query(DDL);
    store = new DrizzleIdempotencyStore(createDb(pool), idempotencyKeys);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('lần đầu giữ chỗ, xong thì trả lại kết quả cũ', async () => {
    expect(await store.begin('u1 POST /orders', 'k1', 'h1', 60)).toEqual({ kind: 'started' });
    expect(await store.begin('u1 POST /orders', 'k1', 'h1', 60)).toEqual({ kind: 'in_progress', requestHash: 'h1' });
    await store.complete('u1 POST /orders', 'k1', 201, { orderId: 'o1' });
    expect(await store.begin('u1 POST /orders', 'k1', 'h1', 60)).toEqual({
      kind: 'replay',
      requestHash: 'h1',
      responseStatus: 201,
      responseBody: { orderId: 'o1' },
    });
  });

  it('10 request cùng lúc cùng key: chỉ đúng 1 được xử lý', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.begin('u2 POST /checkout', 'k-race', 'h', 60)),
    );
    expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(9);
  });

  it('abort xoá chỗ đang giữ để gửi lại được', async () => {
    await store.begin('u3 POST /pay', 'k-abort', 'h', 60);
    await store.abort('u3 POST /pay', 'k-abort');
    expect(await store.begin('u3 POST /pay', 'k-abort', 'h', 60)).toEqual({ kind: 'started' });
  });

  it('dòng đã hết hạn thì coi như chưa có', async () => {
    await store.begin('u4 POST /orders', 'k-exp', 'old', 60);
    await store.complete('u4 POST /orders', 'k-exp', 201, { old: true });
    await pool.query(`update idem_test.idempotency_keys set expires_at = now() - interval '1 second' where key = 'k-exp'`);
    expect(await store.begin('u4 POST /orders', 'k-exp', 'new', 60)).toEqual({ kind: 'started' });
  });
});
