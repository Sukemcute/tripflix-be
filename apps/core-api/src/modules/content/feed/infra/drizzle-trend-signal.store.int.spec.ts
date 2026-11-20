import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import type { TrendSignal } from '../domain/trend-signal.js';
import { DrizzleTrendSignalStore } from './drizzle-trend-signal.store.js';

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/** Bảng content.trend_signals trên Postgres thật: loại trùng, bài không còn, dọn theo lô. */
describe('DrizzleTrendSignalStore trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleTrendSignalStore;

  async function insertPost(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into content.posts (id, author_id, post_type, title, status, visibility)
       values ($1, $2, 'video', 'Bài', 'published', 'public')`,
      [id, AUTHOR_ID],
    );
    return id;
  }

  const signal = (postId: string, over: Partial<TrendSignal> = {}): TrendSignal => ({
    postId,
    kind: 'view',
    actorKey: `u:${USER_ID}`,
    isGuest: false,
    occurredAt: new Date().toISOString(),
    ...over,
  });

  const countSignals = async (postId: string) =>
    Number(
      (await pool.query('select count(*) from content.trend_signals where post_id = $1', [postId])).rows[0]
        .count,
    );

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'trend-signal-int-test' });
    const db = createDb(pool);
    store = new DrizzleTrendSignalStore(() => db);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('mỗi người chỉ một dòng cho mỗi loại trên mỗi bài, sự kiện giao lại không ghi thêm', async () => {
    const postId = await insertPost();

    expect(await store.record(signal(postId))).toBe(true);
    expect(await store.record(signal(postId))).toBe(false);
    expect(await store.record(signal(postId, { kind: 'booking_click' }))).toBe(true);
    expect(
      await store.record(
        signal(postId, { actorKey: 'a:33333333-3333-4333-8333-333333333333', isGuest: true }),
      ),
    ).toBe(true);

    expect(await countSignals(postId)).toBe(3);
  });

  it('bài không có trong content.posts thì bỏ qua, không lỗi khoá ngoại', async () => {
    const missingPostId = randomUUID();

    expect(await store.record(signal(missingPostId))).toBe(false);
    expect(await countSignals(missingPostId)).toBe(0);
  });

  it('chỉ xoá tín hiệu trước mốc, mỗi lượt tối đa limit dòng', async () => {
    const postId = await insertPost();
    const old = '2026-09-01T00:00:00.000Z';
    for (let i = 0; i < 3; i += 1)
      await store.record(signal(postId, { actorKey: `u:${randomUUID()}`, occurredAt: old }));
    await store.record(signal(postId, { actorKey: `u:${randomUUID()}` }));
    const before = new Date('2026-10-01T00:00:00.000Z');

    expect(await store.purgeOlderThan(before, 2)).toBe(2);
    expect(await store.purgeOlderThan(before, 2)).toBe(1);
    expect(await store.purgeOlderThan(before, 2)).toBe(0);
    expect(await countSignals(postId)).toBe(1);
  });

  it('xoá bài thì tín hiệu của bài cũng mất', async () => {
    const postId = await insertPost();
    await store.record(signal(postId));

    await pool.query('delete from content.posts where id = $1', [postId]);

    expect(await countSignals(postId)).toBe(0);
  });
});
