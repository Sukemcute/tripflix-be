import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from '../../access/index.js';
import { registerTestAccount } from '../../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { CoreEnv } from '../../../platform/env.js';
import { applyGlobalPrefix } from '../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../platform/tokens.js';
import {
  AccessModule,
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  MemoryAccessStore,
  MemoryLoginRateLimiter,
} from '../../access/index.js';
import { ContentModule } from '../content.module.js';
import { MEDIA_ASSET_STORE, OBJECT_STORAGE } from '../media/application/ports.js';
import { MemoryMediaAssetStore } from '../media/infra/memory/memory-media-asset.store.js';
import { FEED_STORE, type FeedPostRow, type FeedStore } from './application/ports.js';
import { FEED_EVENT_BUS } from './application/feed-events.use-cases.js';
import type { EventBus, StreamName } from '@tripflix/event-bus';
import type { EventEnvelope } from '@tripflix/contracts';
import { randomUUID } from 'node:crypto';
import { encodeFeedCursor, type FeedCursor } from './domain/feed-cursor.js';

// E2E chạy app Nest thật (controller, guard, jose), chỉ thay database, Redis và S3 bằng bản bộ nhớ.
const env = { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' } as CoreEnv;
const ASSET_ID = '018d9f10-0000-7000-8000-000000000001';
const buildPostId = (n: number) => `018d9f20-0000-7000-8000-00000000000${n}`;

@Global()
@Module({
  providers: [
    { provide: CORE_ENV, useValue: env },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class FakePlatformModule {}

const buildRow = (n: number, mediaIds = [ASSET_ID]): FeedPostRow => ({
  id: buildPostId(n),
  authorId: '018d9f00-0000-7000-8000-000000000001',
  title: `Bài ${n}`,
  body: `Nội dung ${n}`,
  hashtags: ['danang'],
  mediaIds,
  tripAttachment: null,
  reactionTotal: 5,
  commentCount: 4,
  bookmarkCount: 3,
  shareCount: 2,
  cursorAt: `2026-11-05T10:00:0${n}.000000Z`,
});

class FakeFeedStore implements FeedStore {
  rows: FeedPostRow[] = [];
  liked: { userId: string; postId: string }[] = [];

  listPlayablePosts({ limit, after, authorId }: { limit: number; after: FeedCursor | null; authorId?: string }): Promise<FeedPostRow[]> {
    const rows = authorId ? this.rows.filter((row) => row.authorId === authorId) : this.rows;
    const start = after ? rows.findIndex((row) => row.id === after.id) + 1 : 0;
    return Promise.resolve(rows.slice(start, start + limit));
  }

  listHotPosts({ limit, after }: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]> {
    const sorted = [...this.rows].sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
    const start = after ? sorted.findIndex((row) => row.id === after.id) + 1 : 0;
    return Promise.resolve(sorted.slice(start, start + limit));
  }

  /** Bản thật không theo thứ tự nào: trả ngược để test chắc thứ tự là do use case sắp lại. */
  findPlayablePostsByIds(postIds: string[]): Promise<FeedPostRow[]> {
    return Promise.resolve(this.rows.filter((row) => postIds.includes(row.id)).reverse());
  }

  findLikedPostIds(userId: string, postIds: string[]): Promise<string[]> {
    return Promise.resolve(
      this.liked.filter((like) => like.userId === userId && postIds.includes(like.postId)).map((like) => like.postId),
    );
  }

  listSavedPlayablePosts({ userId, limit }: { userId: string; limit: number }): Promise<FeedPostRow[]> {
    this.savedQueriedBy.push(userId);
    return Promise.resolve(this.rows.slice(0, limit));
  }

  savedQueriedBy: string[] = [];

  findSavedPostIds(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

class FakeEventBus implements EventBus {
  published: { stream: StreamName; event: EventEnvelope }[] = [];

  publish(stream: StreamName, event: EventEnvelope): Promise<string> {
    this.published.push({ stream, event });
    return Promise.resolve(`${this.published.length}-0`);
  }
}

interface FeedPageBody {
  items: {
    postId: string;
    author: { id: string; name: string | null };
    video: { hlsUrl: string; posters: { w360: string }; levels: number[]; aspect: string };
    counts: { likes: number; comments: number; saves: number; shares: number };
    viewerState: { liked: boolean; saved: boolean } | null;
  }[];
  nextCursor: string | null;
}

describe('GET /api/v1/feed E2E', () => {
  let app: INestApplication;
  let feedStore: FakeFeedStore;
  let eventBus: FakeEventBus;
  let token: string;
  let userId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    feedStore = new FakeFeedStore();
    eventBus = new FakeEventBus();
    const mediaStore = new MemoryMediaAssetStore();
    mediaStore.assets.set(ASSET_ID, {
      id: ASSET_ID,
      status: 'ready',
      hlsPrefix: `dev/test/videos/${ASSET_ID}/r1`,
      durationSec: 43,
      aspect: '9:16',
      levels: new Set([360, 540]),
    } as never);
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
        ContentModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(new MemoryAccessStore())
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .overrideProvider(MEDIA_ASSET_STORE)
      .useValue(mediaStore)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' }))
      .overrideProvider(FEED_STORE)
      .useValue(feedStore)
      .overrideProvider(FEED_EVENT_BUS)
      .useValue(eventBus)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
    const credentials = { email: 'xem@example.com', password: 'mat-khau-an-toan', displayName: 'Người xem' };
    const registered = await registerTestAccount(app, credentials);
    userId = (registered.body as { id: string }).id;
    const login = await http().post('/api/auth/login').send(credentials).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });

  beforeEach(() => {
    feedStore.rows = [buildRow(1), buildRow(2), buildRow(3)];
    feedStore.liked = [];
    feedStore.savedQueriedBy = [];
    eventBus.published = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('khách xem được, thẻ bài có link phát và viewerState là null', async () => {
    const response = await http().get('/api/v1/feed').expect(200);
    const body = response.body as FeedPageBody;

    expect(body.nextCursor).toBeNull();
    expect(body.items.map((item) => item.postId)).toEqual([buildPostId(1), buildPostId(2), buildPostId(3)]);
    expect(body.items[0]).toMatchObject({
      author: { id: '018d9f00-0000-7000-8000-000000000001', name: null, avatarUrl: null, isKol: false },
      video: {
        hlsUrl: `https://cdn.test/dev/test/videos/${ASSET_ID}/r1/master.m3u8`,
        posters: { w360: `https://cdn.test/dev/test/videos/${ASSET_ID}/r1/poster_360.jpg` },
        durationSec: 43,
        aspect: '9:16',
        levels: [360, 540],
      },
      title: 'Bài 1',
      caption: 'Nội dung 1',
      tags: ['danang'],
      counts: { likes: 5, comments: 4, saves: 3, shares: 2 },
      viewerState: null,
      reason: null,
    });
  });

  it('lọc theo mã tác giả và trả 400 nếu mã không hợp lệ', async () => {
    feedStore.rows[1] = { ...buildRow(2), authorId: userId };
    const response = await http().get('/api/v1/feed').query({ author_id: userId }).expect(200);
    expect((response.body as FeedPageBody).items.map((item) => item.postId)).toEqual([buildPostId(2)]);
    await http().get('/api/v1/feed').query({ author_id: 'not-a-uuid' }).expect(400);
  });

  it('có token thì trả trạng thái thích của đúng người xem', async () => {
    feedStore.liked = [
      { userId, postId: buildPostId(2) },
      { userId: 'nguoi-khac', postId: buildPostId(1) },
    ];

    const response = await http().get('/api/v1/feed').set('Authorization', `Bearer ${token}`).expect(200);
    const { items } = response.body as FeedPageBody;

    expect(items.map((item) => item.viewerState?.liked)).toEqual([false, true, false]);
  });

  it('token sai thì coi như khách, không trả 401', async () => {
    const response = await http().get('/api/v1/feed').set('Authorization', 'Bearer sai').expect(200);

    expect((response.body as FeedPageBody).items[0]?.viewerState).toBeNull();
  });

  it('sang trang bằng nextCursor đi hết bài, không lặp', async () => {
    const first = (await http().get('/api/v1/feed?limit=2').expect(200)).body as FeedPageBody;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (await http().get('/api/v1/feed').query({ limit: 2, cursor: first.nextCursor }).expect(200))
      .body as FeedPageBody;

    expect(second.items.map((item) => item.postId)).toEqual([buildPostId(3)]);
    expect(second.nextCursor).toBeNull();
  });

  it('danh sách trống vẫn trả 200', async () => {
    feedStore.rows = [];

    expect((await http().get('/api/v1/feed').expect(200)).body).toEqual({ items: [], nextCursor: null });
  });

  it('bài có video biến mất giữa hai lần đọc thì bị bỏ, không trả thẻ thiếu link phát', async () => {
    feedStore.rows = [buildRow(1, ['018d9f10-0000-7000-8000-00000000dead']), buildRow(2)];

    const { items } = (await http().get('/api/v1/feed').expect(200)).body as FeedPageBody;

    expect(items.map((item) => item.postId)).toEqual([buildPostId(2)]);
  });

  it('tab hot xếp theo điểm và sang trang bằng cursor có điểm', async () => {
    feedStore.rows = [
      buildRow(1),
      { ...buildRow(2), hotScore: 1 },
      { ...buildRow(3), hotScore: 0.4 },
    ];

    const first = (await http().get('/api/v1/feed?tab=hot&limit=2').expect(200)).body as FeedPageBody;
    const second = (await http().get(`/api/v1/feed?tab=hot&limit=2&cursor=${first.nextCursor}`).expect(200))
      .body as FeedPageBody;

    expect(first.items.map((item) => item.postId)).toEqual([buildPostId(2), buildPostId(3)]);
    expect(second.items.map((item) => item.postId)).toEqual([buildPostId(1)]);
    expect(second.nextCursor).toBeNull();
  });

  it('TF121: tab for_you trả cùng thứ tự với tab hot, sang trang bằng cursor có điểm', async () => {
    feedStore.rows = [
      buildRow(1),
      { ...buildRow(2), hotScore: 1 },
      { ...buildRow(3), hotScore: 0.4 },
    ];

    const hot = (await http().get('/api/v1/feed?tab=hot&limit=3').expect(200)).body as FeedPageBody;
    const first = (await http().get('/api/v1/feed?tab=for_you&limit=2').expect(200)).body as FeedPageBody;
    const second = (await http().get(`/api/v1/feed?tab=for_you&limit=2&cursor=${first.nextCursor}`).expect(200))
      .body as FeedPageBody;

    expect([...first.items, ...second.items].map((item) => item.postId)).toEqual(hot.items.map((item) => item.postId));
    expect(first.items.map((item) => item.postId)).toEqual([buildPostId(2), buildPostId(3)]);
    expect(second.nextCursor).toBeNull();
  });

  it('TF121: cursor for_you cũ (có rank, chưa có điểm Hot) thì trả lại trang Hot đầu, không lỗi', async () => {
    feedStore.rows = [buildRow(1), { ...buildRow(2), hotScore: 1 }];
    const oldCursor = encodeFeedCursor({
      at: '2026-11-05T10:00:01.000000Z',
      id: buildPostId(1),
      rank: 0.5,
      seed: 1,
      asOf: '2026-11-13T00:00:00.000Z',
    });

    const page = (await http().get(`/api/v1/feed?tab=for_you&limit=2&cursor=${oldCursor}`).expect(200)).body as FeedPageBody;

    expect(page.items.map((item) => item.postId)).toEqual([buildPostId(2), buildPostId(1)]);
  });

  it('TF121: Reels đã lưu không nhận cursor có điểm Hot', async () => {
    const hotScoreCursor = encodeFeedCursor({ at: '2026-11-05T10:00:01.000000Z', id: buildPostId(1), score: 0.7, seed: 2 });

    await http().get(`/api/v1/feed?saved=true&cursor=${hotScoreCursor}`).set('Authorization', `Bearer ${token}`).expect(400);
  });

  const plainCursor = encodeFeedCursor({ at: '2026-11-05T10:00:01.000000Z', id: buildPostId(1) });
  const hotCursor = encodeFeedCursor({ at: '2026-11-05T10:00:01.000000Z', id: buildPostId(1), score: 0.7 });
  const rankedCursor = encodeFeedCursor({
    at: '2026-11-05T10:00:01.000000Z',
    id: buildPostId(1),
    score: 7,
    rank: 0.5,
    seed: 1,
    asOf: '2026-11-13T00:00:00.000Z',
  });

  it.each([
    ['tab chưa có', 'tab=following'],
    ['cursor của for_you dùng cho hot', `tab=hot&cursor=${plainCursor}`],
    ['cursor có điểm Hot dùng cho trang tác giả của for_you', `author_id=018d9f00-0000-7000-8000-000000000001&cursor=${hotCursor}`],
    ['cursor có rank của for_you dùng cho hot', `tab=hot&cursor=${rankedCursor}`],
    ['limit vượt 20', 'limit=21'],
    ['limit bằng 0', 'limit=0'],
    ['limit không phải số', 'limit=abc'],
    ['cursor sai', 'cursor=sai'],
    ['saved sai', 'saved=yes'],
    ['saved với tab hot', 'saved=true&tab=hot'],
  ])('%s thì trả 400', async (_name, query) => {
    await http().get(`/api/v1/feed?${query}`).expect(400);
  });

  it('post_ids trả thẻ đúng thứ tự truyền vào, bỏ bài không xem được, có trạng thái thích', async () => {
    feedStore.liked = [{ userId, postId: buildPostId(1) }];
    const missing = buildPostId(9);

    const response = await http()
      .get('/api/v1/feed')
      .query({ post_ids: `${buildPostId(3)},${missing},${buildPostId(1)},${buildPostId(3)}` })
      .auth(token, { type: 'bearer' })
      .expect(200);
    const body = response.body as FeedPageBody;

    expect(body.items.map((item) => item.postId)).toEqual([buildPostId(3), buildPostId(1)]);
    expect(body.items.map((item) => item.viewerState?.liked)).toEqual([false, true]);
    expect(body.items[0]?.video.hlsUrl).toContain('master.m3u8');
    expect(body.nextCursor).toBeNull();
  });

  it('post_ids sai dạng, quá 20 id hoặc ghép với cursor, saved, author_id thì trả 400', async () => {
    await http().get('/api/v1/feed').query({ post_ids: 'khong-phai-uuid' }).expect(400);
    await http().get('/api/v1/feed').query({ post_ids: ',' }).expect(400);
    const tooMany = Array.from({ length: 21 }, (_, i) => buildPostId(i)).join(',');
    await http().get('/api/v1/feed').query({ post_ids: tooMany }).expect(400);
    await http().get('/api/v1/feed').query({ post_ids: buildPostId(1), author_id: userId }).expect(400);
  });

  it('saved=true khi chưa đăng nhập trả 401', async () => {
    await http().get('/api/v1/feed?saved=true').expect(401);
    expect(feedStore.savedQueriedBy).toEqual([]);
  });

  it('saved=true có token thì đọc Reels đã lưu của đúng người xem', async () => {
    await http().get('/api/v1/feed?saved=true').auth(token, { type: 'bearer' }).expect(200);
    expect(feedStore.savedQueriedBy).toEqual([userId]);
  });

  it('TF23: khách gửi lượt xem, chỉ bài xem được mới vào stream:app-events, giữ eventId của app', async () => {
    const anonId = randomUUID();
    const eventId = randomUUID();
    const response = await http()
      .post('/api/v1/feed/events')
      .set('X-Anon-Id', anonId)
      .send({
        events: [
          { eventId, type: 'view', postId: buildPostId(1), watchedMs: 20_000, surface: 'reels' },
          { eventId: randomUUID(), type: 'view', postId: buildPostId(2), watchedMs: 3_000, surface: 'reels' },
          { eventId: randomUUID(), type: 'view', postId: buildPostId(9), watchedMs: 20_000, surface: 'reels' },
        ],
      })
      .expect(202);

    expect(response.body).toEqual({ accepted: 2 });
    expect(eventBus.published.map(({ stream }) => stream)).toEqual(['stream:app-events', 'stream:app-events']);
    expect(eventBus.published[0]?.event).toMatchObject({
      eventId,
      type: 'content.post.viewed',
      version: 1,
      userId: null,
      payload: { postId: buildPostId(1), viewerId: null, anonId, watchedMs: 20_000, durationSec: 43, isQualified: true, surface: 'reels' },
    });
    // 3 giây của video 43 giây: chưa tới 15 giây, chưa tới nửa thời lượng.
    expect(eventBus.published[1]?.event.payload).toMatchObject({ postId: buildPostId(2), isQualified: false });
  });

  it('TF23: người đã đăng nhập bấm đặt từ lộ trình, X-Anon-Id sai dạng thì bỏ qua', async () => {
    await http()
      .post('/api/v1/feed/events')
      .auth(token, { type: 'bearer' })
      .set('X-Anon-Id', 'khong-phai-uuid')
      .send({
        events: [
          { eventId: randomUUID(), type: 'booking_click', postId: buildPostId(1), hotelId: 'P-osm-1', surface: 'reels_trip_plan' },
        ],
      })
      .expect(202);

    expect(eventBus.published[0]?.event).toMatchObject({
      type: 'content.post.booking_clicked',
      userId,
      payload: { postId: buildPostId(1), viewerId: userId, anonId: null, hotelId: 'P-osm-1', surface: 'reels_trip_plan' },
    });
  });

  it('TF23: lô rỗng, quá 50 sự kiện hoặc sự kiện sai dạng thì trả 400, không phát gì', async () => {
    const view = () => ({ eventId: randomUUID(), type: 'view', postId: buildPostId(1), watchedMs: 1_000, surface: 'reels' });
    await http().post('/api/v1/feed/events').send({ events: [] }).expect(400);
    await http()
      .post('/api/v1/feed/events')
      .send({ events: Array.from({ length: 51 }, view) })
      .expect(400);
    await http()
      .post('/api/v1/feed/events')
      .send({ events: [{ ...view(), watchedMs: -5 }] })
      .expect(400);
    await http()
      .post('/api/v1/feed/events')
      .send({ events: [{ ...view(), type: 'booking_click', surface: 'reels' }] })
      .expect(400);

    expect(eventBus.published).toEqual([]);
  });
});

