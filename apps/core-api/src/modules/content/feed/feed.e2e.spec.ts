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
import type { FeedCursor } from './domain/feed-cursor.js';

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
  reactionTotal: 5,
  commentCount: 4,
  bookmarkCount: 3,
  shareCount: 2,
  cursorAt: `2026-11-05T10:00:0${n}.000000Z`,
});

class FakeFeedStore implements FeedStore {
  rows: FeedPostRow[] = [];
  liked: { userId: string; postId: string }[] = [];

  listPlayablePosts({ limit, after }: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]> {
    const start = after ? this.rows.findIndex((row) => row.id === after.id) + 1 : 0;
    return Promise.resolve(this.rows.slice(start, start + limit));
  }

  findLikedPostIds(userId: string, postIds: string[]): Promise<string[]> {
    return Promise.resolve(
      this.liked.filter((like) => like.userId === userId && postIds.includes(like.postId)).map((like) => like.postId),
    );
  }

  findSavedPostIds(): Promise<string[]> {
    return Promise.resolve([]);
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
  let token: string;
  let userId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    feedStore = new FakeFeedStore();
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
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
    const credentials = { email: 'xem@example.com', password: 'mat-khau-an-toan', displayName: 'Người xem' };
    const registered = await http().post('/api/auth/register').send(credentials).expect(201);
    userId = (registered.body as { id: string }).id;
    const login = await http().post('/api/auth/login').send(credentials).expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });

  beforeEach(() => {
    feedStore.rows = [buildRow(1), buildRow(2), buildRow(3)];
    feedStore.liked = [];
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

  it.each([
    ['tab chưa có', 'tab=hot'],
    ['limit vượt 20', 'limit=21'],
    ['limit bằng 0', 'limit=0'],
    ['limit không phải số', 'limit=abc'],
    ['cursor sai', 'cursor=sai'],
  ])('%s thì trả 400', async (_name, query) => {
    await http().get(`/api/v1/feed?${query}`).expect(400);
  });
});
