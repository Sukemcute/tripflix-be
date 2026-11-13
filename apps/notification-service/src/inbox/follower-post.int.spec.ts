import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import pg from 'pg';
import { envSchema } from '../env.js';
import { FollowerPostWorker } from './follower-post.worker.js';
import { InboxRepository } from './inbox.repository.js';

describe('Gửi inbox bài mới theo từng lô', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let inbox: InboxRepository;

  beforeAll(async () => {
    fixture = await startPostgres();
    const url = fixture.buildModuleUrl('notification');
    pool = new pg.Pool({ connectionString: url });
    inbox = new InboxRepository(pool);
    await inbox.onModuleInit();
  });

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });

  it('chia 1.000 người thành lô và nhường lượt cho bài nhỏ giữa hai lô', async () => {
    const authorId = randomUUID();
    const largePost = randomUUID();
    const smallPost = randomUUID();
    const recipients: string[] = Array.from({ length: 1000 }, () => randomUUID()).sort();
    const smallRecipient = randomUUID();
    const env = envSchema.parse({
      DATABASE_URL_NOTIFICATION: fixture.buildModuleUrl('notification'),
      FOLLOWER_NOTIFICATION_SECRET: 'test-only',
      FOLLOWER_CORE_URL: 'http://localhost:3000',
    });
    const worker = new FollowerPostWorker(pool, env);
    const secondWorker = new FollowerPostWorker(pool, env);
    const fetchedPosts: string[] = [];
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('service-token')) return Response.json({ accessToken: 'test-token', expiresIn: 300 });
      if (url.pathname.includes(smallPost)) {
        fetchedPosts.push(smallPost);
        return Response.json({ isEligible: true, recipients: [smallRecipient], nextCursor: null });
      }
      fetchedPosts.push(largePost);
      const cursor = url.searchParams.get('cursor');
      const offset = cursor ? recipients.indexOf(cursor) + 1 : 0;
      if (!cursor) await worker.enqueue(smallPost, authorId);
      const batch = recipients.slice(offset, offset + 200);
      return Response.json({
        isEligible: true, recipients: batch, nextCursor: offset + 200 < recipients.length ? batch.at(-1) : null,
      });
    });

    try {
      await worker.enqueue(largePost, authorId);
      worker.onApplicationBootstrap();
      secondWorker.onApplicationBootstrap();
      await vi.waitFor(async () => {
        expect(await inbox.countUnread(recipients.at(-1)!)).toBe(1);
      }, { timeout: 10000 });
      expect(fetchedPosts).toEqual([largePost, smallPost, largePost, largePost, largePost, largePost]);
      expect(await inbox.countUnread(smallRecipient)).toBe(1);
      const { rows } = await pool.query(
        "SELECT count(*)::integer AS count FROM inbox WHERE source_event_id = 'follower-post:' || $1", [largePost],
      );
      expect(rows[0].count).toBe(1000);
    } finally {
      await Promise.all([worker.onModuleDestroy(), secondWorker.onModuleDestroy()]);
      fetchStub.mockRestore();
    }
  });

  it('hiện một thông báo dùng chung, giữ trạng thái đọc riêng và ẩn khi bỏ theo dõi', async () => {
    const postId = randomUUID();
    const authorId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const stranger = randomUUID();
    const late = randomUUID();
    const env = envSchema.parse({
      DATABASE_URL_NOTIFICATION: fixture.buildModuleUrl('notification'),
      FOLLOWER_NOTIFICATION_SECRET: 'test-only',
      FOLLOWER_CORE_URL: 'http://localhost:3000',
      FOLLOWER_SHARED_THRESHOLD: 10000,
    });
    const worker = new FollowerPostWorker(pool, env);
    const followedAt = '2026-11-12T08:00:00Z';
    for (const followerId of [first, second]) {
      await worker.applyFollow({ followerId, authorId, followedAt, changedAt: followedAt });
    }
    await worker.applyFollow({ followerId: late, authorId, followedAt: '2026-11-12T10:00:00Z', changedAt: '2026-11-12T10:00:00Z' });
    const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('service-token')) return Response.json({ accessToken: 'fixture', expiresIn: 300 });
      expect(url.searchParams.get('sharedThreshold')).toBe('10000');
      return Response.json({ isEligible: true, recipients: [], nextCursor: null, sharedPublishedAt: '2026-11-12T09:00:00Z' });
    });
    try {
      await worker.enqueue(postId, authorId);
      worker.onApplicationBootstrap();
      await vi.waitFor(async () => expect(await inbox.countUnread(first)).toBe(1), { timeout: 5000 });
      expect(await inbox.countUnread(stranger)).toBe(0);
      expect(await inbox.countUnread(late)).toBe(0);
      const personal = await inbox.insert({ userId: first, type: 'comment.created', title: 'Bình luận', body: '', link: null, data: {}, sourceEventId: randomUUID() });
      const firstPage = await inbox.listForUser(first, { limit: 1 });
      expect(firstPage.items[0]?.id).toBe(personal?.id);
      const secondPage = await inbox.listForUser(first, { limit: 1, cursor: firstPage.nextCursor! });
      expect(secondPage.items[0]?.id).toBe(postId);
      expect(await inbox.markRead(stranger, postId)).toBe(false);
      expect(await inbox.markAllReadThrough(first, postId)).toBe(true);
      expect(await inbox.countUnread(first)).toBe(1);
      expect(await inbox.countUnread(second)).toBe(1);
      expect(await inbox.markRead(second, postId)).toBe(true);
      expect(await inbox.markAllRead(first)).toBe(1);
      expect(await inbox.markAllRead(second)).toBe(0);
      expect((await pool.query('SELECT id FROM inbox WHERE source_event_id = $1', ['follower-post:' + postId])).rowCount).toBe(0);
      await worker.applyFollow({ followerId: first, authorId, followedAt: null, changedAt: '2026-11-12T11:00:00Z' });
      await worker.applyFollow({ followerId: first, authorId, followedAt, changedAt: followedAt });
      expect((await inbox.listForUser(first, { limit: 20 })).items.map((item) => item.id)).toEqual([personal?.id]);
      await worker.cancel(postId, authorId);
      expect((await inbox.listForUser(second, { limit: 20 })).items).toEqual([]);
    } finally {
      await worker.onModuleDestroy();
      stub.mockRestore();
    }
  });

  it('ghi đủ hai lô dù enqueue trùng, rồi ẩn cả hai khi bài bị hủy', async () => {
    const postId = randomUUID();
    const authorId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const env = envSchema.parse({
      DATABASE_URL_NOTIFICATION: fixture.buildModuleUrl('notification'),
      FOLLOWER_NOTIFICATION_SECRET: 'test-only',
      FOLLOWER_CORE_URL: 'http://localhost:3000',
    });
    const worker = new FollowerPostWorker(pool, env);
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('service-token')) {
        return Response.json({ accessToken: 'test-token', expiresIn: 300 });
      }
      const cursor = url.searchParams.get('cursor');
      if (!cursor) return Response.json({ isEligible: true, recipients: [first], nextCursor: first });
      expect(cursor).toBe(first);
      return Response.json({ isEligible: true, recipients: [second], nextCursor: null });
    });
    try {
      await Promise.all([worker.enqueue(postId, authorId), worker.enqueue(postId, authorId)]);
      worker.onApplicationBootstrap();
      await vi.waitFor(async () => {
        expect(await inbox.countUnread(first)).toBe(1);
        expect(await inbox.countUnread(second)).toBe(1);
      }, { timeout: 5000 });
      const { items } = await inbox.listForUser(first, { limit: 20, tab: 'interactions' });
      expect(items).toEqual([expect.objectContaining({ link: `/trips/${postId}` })]);
      await worker.cancel(postId, authorId);
      await worker.enqueue(postId, authorId);
      expect(await inbox.countUnread(first)).toBe(0);
      expect(await inbox.countUnread(second)).toBe(0);
      expect(await inbox.markRead(first, items[0]!.id)).toBe(false);
    } finally {
      await worker.onModuleDestroy();
      fetchStub.mockRestore();
    }
  });
});
