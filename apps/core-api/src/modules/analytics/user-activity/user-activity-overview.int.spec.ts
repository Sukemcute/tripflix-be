import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { UserActivityUseCases } from './application/user-activity.use-cases.js';
import { DrizzleUserActivityStore } from './infra/drizzle-user-activity.store.js';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const postA = '33333333-3333-4333-8333-333333333333';
const postB = '44444444-4444-4444-8444-444444444444';

const event = (type: string, at: string, payload: Record<string, unknown>, userId: string | null = null): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: at,
  producer: 'content-service',
  userId,
  payload,
});

describe('Tổng quan hành vi: SQL thật trên PostgreSQL (SCRUM-181)', () => {
  let postgres: PostgresFixture | undefined;
  let pool: pg.Pool | undefined;
  let activity: UserActivityUseCases;
  let store: DrizzleUserActivityStore;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('analytics');
    await migrateModule({ url, module: 'analytics', migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 3, applicationName: 'analytics-user-overview-test' });
    store = new DrizzleUserActivityStore(createDb(pool));
    activity = new UserActivityUseCases(store);

    // 17:30 UTC ngày 17 là 00:30 ngày 18 giờ Việt Nam, nên bài và chia sẻ này thuộc ngày 18.
    await activity.record(event('content.post.published', '2026-11-17T17:30:00.000Z', { postId: postA, authorId: alice, postType: 'video' }, alice));
    await activity.record(event('content.post.published', '2026-11-18T05:00:00.000Z', { postId: postB, authorId: bob, postType: 'article' }, bob));
    await activity.record(event('content.post.shared', '2026-11-17T17:40:00.000Z', { postId: postA, userId: bob, shareUrl: 'https://x' }, bob));
    await activity.record(event('content.post.shared', '2026-11-18T06:00:00.000Z', { postId: postA, userId: bob, shareUrl: 'https://x' }, bob));
    await activity.record(event('content.post.shared', '2026-11-18T06:10:00.000Z', { postId: postA, userId: null, shareUrl: 'https://x' }));
    await activity.record(event('content.reaction.updated', '2026-11-16T10:00:00.000Z', { postId: postA, userId: bob, type: 'like', reactionTotal: 1, reactionCounts: {} }, bob));
  });
  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  const window = { from: new Date('2026-11-15T17:00:00Z'), to: new Date('2026-11-18T17:00:00Z') };

  it('tổng toàn hệ thống: đếm bài đăng, chia sẻ của người đăng nhập, người hoạt động không trùng', async () => {
    const totals = await store.totals(window);

    expect(totals).toEqual({ activeUsers: 2, reactions: 1, comments: 0, shares: 2, views: 0, chats: 0, posts: 2 });
  });

  it('theo ngày giờ Việt Nam: chuỗi ngày là text, sắp cũ trước, lượt lúc 17:30 UTC tính sang ngày sau', async () => {
    const days = await store.daily(window);

    expect(days.map((day) => day.date)).toEqual(['2026-11-16', '2026-11-18']);
    expect(days[0]).toMatchObject({ reactions: 1, posts: 0, shares: 0 });
    expect(days[1]).toMatchObject({ reactions: 0, posts: 2, shares: 2 });
  });

  it('số bài của từng người nằm trong bảng người dùng', async () => {
    const { rows } = await store.summarize({ ...window, limit: 10, offset: 0 });

    expect(rows.find((row) => row.userId === alice)).toMatchObject({ posts: 1, shares: 0 });
    expect(rows.find((row) => row.userId === bob)).toMatchObject({ posts: 1, shares: 2, reactions: 1 });
  });

  it('khoảng không có hoạt động thì toàn số 0 và không có ngày', async () => {
    const empty = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-02T00:00:00Z') };

    expect(await store.totals(empty)).toEqual({ activeUsers: 0, reactions: 0, comments: 0, shares: 0, views: 0, chats: 0, posts: 0 });
    expect(await store.daily(empty)).toEqual([]);
  });
});
