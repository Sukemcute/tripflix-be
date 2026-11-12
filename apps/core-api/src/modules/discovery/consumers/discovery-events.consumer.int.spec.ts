import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb, createPool } from '@tripflix/db';
import { RedisStreamsConsumer, RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { migrateModule, startPostgres, startRedis, type PostgresFixture, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import type pg from 'pg';
import type { CoreEnv } from '../../../platform/env.js';
import { RecommendIngestUseCases } from '../recommend/application/ingest.use-cases.js';
import { RedisRecentPostsStore } from '../recommend/infra/redis-recent-posts.store.js';
import type { RecommendStore } from '../recommend/application/ports.js';
import { DrizzleRecommendStore } from '../recommend/infra/drizzle-recommend.store.js';
import type { ExploreUseCases } from '../search/application/explore.use-cases.js';
import { DiscoveryEventsConsumer } from './discovery-events.consumer.js';

const U = randomUUID();
const P = randomUUID();
const HIDDEN = randomUUID();
const CLAIM_IDLE_MS = 200;

const envelope = (type: string, payload: Record<string, unknown>, occurredAt: string): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt,
  producer: 'core-api',
  payload,
});
const reaction = (type: string | null, occurredAt: string) =>
  envelope('content.reaction.updated', { postId: P, userId: U, type, reactionTotal: 1, reactionCounts: {} }, occurredAt);

/**
 * Consumer gộp trên Redis Streams + Postgres thật: một group core-discovery cho cả search lẫn recommend,
 * giao lại khi recommend lỗi giữa chừng vẫn ra đúng 1 dòng, sự kiện cũ đến sau không đè dòng mới.
 */
describe('DiscoveryEventsConsumer trên Redis + Postgres thật', () => {
  let postgres: PostgresFixture;
  let redisFixture: RedisFixture;
  let pool: pg.Pool;
  let redis: Redis;
  let bus: RedisStreamsEventBus;
  let streams: RedisStreamsConsumer;
  const dropHidden = vi.fn(async () => 1);
  let failNextUpsert = false;

  beforeAll(async () => {
    [postgres, redisFixture] = await Promise.all([startPostgres(), startRedis()]);
    const url = postgres.buildModuleUrl('discovery');
    await migrateModule({ url, module: 'discovery', migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'discovery-consumer-int-test' });
    redis = new Redis(redisFixture.url);
    bus = new RedisStreamsEventBus(redis);

    const real = new DrizzleRecommendStore(createDb(pool));
    // Lỗi sau khi đã ghi (như worker chết trước XACK): lần giao lại phải không ghi đôi.
    const store: RecommendStore = Object.assign(Object.create(real) as RecommendStore, {
      upsertInteractions: async (...args: Parameters<RecommendStore['upsertInteractions']>) => {
        await real.upsertInteractions(...args);
        if (failNextUpsert) {
          failNextUpsert = false;
          throw new Error('mất kết nối trước XACK');
        }
      },
    });
    const consumer = new DiscoveryEventsConsumer(
      { APP_ROLE: 'api' } as CoreEnv,
      redis,
      { dropHidden } as unknown as ExploreUseCases,
      new RecommendIngestUseCases(store, new RedisRecentPostsStore(redis)),
    );
    streams = new RedisStreamsConsumer({
      redis,
      group: 'core-discovery',
      consumer: 'test',
      streams: [STREAMS.content, STREAMS.commerce, STREAMS.access, STREAMS.discovery],
      handler: (event) => consumer.route(event),
      claimIdleMs: CLAIM_IDLE_MS,
      blockMs: 100,
      onError: () => undefined,
    });
    await streams.ensureGroups();
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisFixture?.stop()]);
  });

  const rows = async () => (await pool.query('select is_removed, detail from discovery.recommend_interactions')).rows;
  const pending = async () => ((await redis.xpending(STREAMS.content, 'core-discovery')) as [number])[0];

  it('recommend lỗi lần đầu: giao lại ra đúng 1 dòng, search vẫn gỡ bài ẩn', async () => {
    failNextUpsert = true;
    await bus.publish(STREAMS.content, envelope('content.post.deleted', { postId: HIDDEN }, '2026-11-12T10:00:00.000Z'));
    await bus.publish(STREAMS.content, reaction('love', '2026-11-12T10:00:00.000Z'));

    expect(await streams.pollOnce()).toBe(1); // bài ẩn xong; cảm xúc lỗi, chưa XACK
    expect(dropHidden).toHaveBeenCalledWith([HIDDEN]);
    expect(await pending()).toBe(1);

    await new Promise((r) => setTimeout(r, CLAIM_IDLE_MS + 50));
    expect(await streams.pollOnce()).toBe(1); // giao lại, XACK
    expect(await pending()).toBe(0);
    expect(await rows()).toEqual([{ is_removed: false, detail: { type: 'love' } }]);
    expect(dropHidden).toHaveBeenCalledTimes(1);
    // Gu trong phiên: bài vừa thả cảm xúc vào Redis với điểm = lúc tương tác.
    expect(await redis.zrange(`discovery:recommend:recent:${U}`, '0', '-1', 'WITHSCORES')).toEqual([P, String(Date.parse('2026-11-12T10:00:00.000Z'))]);
  });

  it('sự kiện cũ đến sau không đè dòng mới; gỡ mới hơn thì ghi đè', async () => {
    await bus.publish(STREAMS.content, reaction(null, '2026-11-12T09:00:00.000Z'));
    await streams.pollOnce();
    expect(await rows()).toEqual([{ is_removed: false, detail: { type: 'love' } }]);

    await bus.publish(STREAMS.content, reaction(null, '2026-11-12T11:00:00.000Z'));
    await streams.pollOnce();
    expect(await rows()).toEqual([{ is_removed: true, detail: { type: null } }]);
    expect(await redis.zcard(`discovery:recommend:recent:${U}`)).toBe(0);
  });

  it('đọc cả commerce, access, discovery trong cùng group', async () => {
    const at = '2026-11-12T12:00:00.000Z';
    await bus.publish(STREAMS.access, envelope('access.user.registered', { userId: U, displayName: 'A' }, at));
    await bus.publish(
      STREAMS.discovery,
      envelope('discovery.stays.searched', { userId: U, placeId: 'da-lat', checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2, rooms: 1, minStars: null, priceMax: null, resultCount: 4 }, at),
    );
    await bus.publish(
      STREAMS.commerce,
      envelope('commerce.order.paid', { orderId: randomUUID(), userId: U, total: 1, sourcePostId: null, items: [{ productType: 'room', productId: 'H1', date: '2026-12-01', nights: 2, qty: 1 }] }, at),
    );
    expect(await streams.pollOnce()).toBe(3);
    const { rows: kinds } = await pool.query('select kind from discovery.recommend_interactions order by kind');
    expect(kinds.map((r: { kind: string }) => r.kind)).toEqual(['order_item', 'reaction', 'registered', 'stays_search']);
  });
});
