import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  MODULES,
  buildDrizzleToken,
  buildTransactionHostToken,
  createDb,
  createPool,
  createTransactionalPlugins,
  type ModuleTransactionHost,
} from '@tripflix/db';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { OutboxWriter } from '@tripflix/outbox';
import { contentOutboxEvents } from '../../db/schema/index.js';
import { ModerationRepository } from '../../moderation/infra/moderation.repository.js';
import { ChangeVisibilityUseCase } from '../../moderation/application/change-visibility.use-case.js';
import { AdminModeratePostUseCase } from '../../social/application/use-cases/admin-moderate-post.use-case.js';
import { DeleteCommentUseCase } from '../../social/application/use-cases/delete-comment.use-case.js';
import { PostRepository } from '../../social/infra/post.repository.js';
import { CommentRepository } from '../../social/infra/comment.repository.js';
import { ModerationActionRepository } from '../../social/infra/moderation-action.repository.js';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { DrizzleMediaAssetStore } from '../../media/infra/drizzle-media-asset.store.js';
import { MediaFacade } from '../../media/media.facade.js';
import { decodeFeedCursor } from '../domain/feed-cursor.js';
import { FEED_SEED_COUNT } from '../domain/feed-rank.js';
import { HOT_WINDOW_DAYS } from '../domain/hot-score.js';
import { DrizzleFeedStore } from '../infra/drizzle-feed.store.js';
import { FeedUseCases } from './feed.use-cases.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';
const FRESH_ID = '44444444-4444-4444-8444-444444444444';
const OLD_ID = '55555555-5555-4555-8555-555555555555';

/** Câu truy vấn của feed trên Postgres thật, gồm cả điều kiện lọc jsonb và so sánh cursor. */
describe('Feed trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let feed: FeedUseCases;
  let moduleRef: TestingModule;
  let visibility: ChangeVisibilityUseCase;
  let deleteComment: DeleteCommentUseCase;
  /** Số FeedUseCases dùng để chọn seed ở trang đầu (seed = floor(số × 16)). */
  let nextRandom = 0;
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  async function insertAsset(status: string, levels: number[] = []): Promise<string> {
    const id = randomUUID();
    const ready = status === 'ready';
    await pool.query(
      `insert into content.media_assets (id, owner_id, status, mime_type, file_size_bytes, source_key, hls_prefix, aspect, duration_sec)
       values ($1, $2, $3, 'video/mp4', 1, $4, $5, $6, 40)`,
      [
        id,
        OWNER_ID,
        status,
        `dev/test/uploads/${id}/original.mp4`,
        ready ? `dev/test/videos/${id}/r1` : null,
        ready ? '9:16' : null,
      ],
    );
    for (const level of levels) {
      await pool.query('insert into content.renditions (asset_id, level) values ($1, $2)', [id, level]);
    }
    return id;
  }

  async function insertPost(
    // unknown để dựng được cả dữ liệu sai (ví dụ chuỗi thay vì mảng) như đã gặp trên staging.
    mediaIds: unknown,
    options: {
      authorId?: string;
      status?: string;
      visibility?: string;
      createdAt?: string;
      deleted?: boolean;
      postType?: 'video' | 'vlog';
      id?: string;
    } = {},
  ) {
    const id = options.id ?? randomUUID();
    await pool.query(
      `insert into content.posts (id, author_id, post_type, title, status, visibility, media_ids, created_at, deleted_at)
       values ($1, $2, $8, 'Bài', $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
      [
        id,
        options.authorId ?? OWNER_ID,
        options.status ?? 'published',
        options.visibility ?? 'public',
        JSON.stringify(mediaIds),
        options.createdAt ?? new Date().toISOString(),
        options.deleted ? new Date().toISOString() : null,
        options.postType ?? 'video',
      ],
    );
    return id;
  }

  async function readAllPages(
    limit: number,
    viewerId: string | null = null,
    authorId?: string,
    tab: 'for_you' | 'hot' = 'for_you',
  ) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const after = cursor ? decodeFeedCursor(cursor) : null;
      const page = await feed.getPage({ tab, limit, after, viewerId, authorId });
      ids.push(...page.items.map((item) => item.postId));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 3, applicationName: 'feed-int-test' });
    const db = createDb(pool);
    @Global()
    @Module({
      providers: MODULES.map((name) => ({ provide: buildDrizzleToken(name), useValue: db })),
      exports: MODULES.map(buildDrizzleToken),
    })
    class TestDrizzleModule {}
    moduleRef = await Test.createTestingModule({
      imports: [
        TestDrizzleModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([TestDrizzleModule]) }),
      ],
    }).compile();
    await moduleRef.init();
    const tx = moduleRef.get<ModuleTransactionHost>(buildTransactionHostToken('content'));
    const posts = new PostRepository(() => tx.tx);
    const outbox = new OutboxWriter(() => tx.tx, contentOutboxEvents, 'core-api/content');
    visibility = new ChangeVisibilityUseCase(
      new ModerationRepository(() => tx.tx),
      posts,
      outbox,
      new AdminModeratePostUseCase(posts, new ModerationActionRepository(() => tx.tx), outbox),
    );
    deleteComment = new DeleteCommentUseCase(new CommentRepository(() => tx.tx), posts, outbox);
    feed = new FeedUseCases(
      new DrizzleFeedStore(() => db),
      new MediaFacade(
        new DrizzleMediaAssetStore(() => db),
        new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' }),
      ),
      undefined,
      undefined,
      () => nextRandom,
    );
  }, 120_000);

  beforeEach(async () => {
    nextRandom = 0;
    await pool.query('truncate content.posts, content.media_assets cascade');
  });

  async function setCounts(
    postId: string,
    counts: { likes?: number; comments?: number; saves?: number; shares?: number },
  ) {
    await pool.query(
      'update content.posts set reaction_total = $2, comment_count = $3, bookmark_count = $4, share_count = $5 where id = $1',
      [postId, counts.likes ?? 0, counts.comments ?? 0, counts.saves ?? 0, counts.shares ?? 0],
    );
  }

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    await postgres?.stop();
  });

  it('lọc Reels công khai theo tác giả trước khi phân trang', async () => {
    const asset = await insertAsset('ready', [360]);
    const newest = await insertPost([asset], { createdAt: '2026-11-05T10:00:03Z' });
    await insertPost([asset], { authorId: VIEWER_ID, createdAt: '2026-11-05T10:00:02Z' });
    const oldest = await insertPost([asset], { createdAt: '2026-11-05T10:00:01Z' });
    await insertPost([asset], { visibility: 'private' });
    await insertPost([asset], { postType: 'vlog' });

    expect(await readAllPages(1, null, OWNER_ID)).toEqual([newest, oldest]);
  });

  it('chỉ trả bài công khai đã đăng có video phát được', async () => {
    const playable = await insertAsset('ready', [360]);
    const expected = await insertPost([playable]);
    await insertPost([await insertAsset('processing')]);
    await insertPost([await insertAsset('failed')]);
    // Giống seed cũ: ghi ready nhưng chưa có mức nào, file trên CDN chưa chắc tồn tại.
    await insertPost([await insertAsset('ready')]);
    await insertPost([randomUUID()]);
    await insertPost([]);
    await insertPost([playable], { status: 'draft' });
    await insertPost([playable], { status: 'hidden' });
    await insertPost([playable], { visibility: 'private' });
    await insertPost([playable], { deleted: true });

    const page = await feed.getPage({ limit: 20, after: null, viewerId: null });

    expect(page.items.map((item) => item.postId)).toEqual([expected]);
    expect(page.items[0]?.video.hlsUrl).toBe(`https://cdn.test/dev/test/videos/${playable}/r1/master.m3u8`);
    expect(page.nextCursor).toBeNull();
  });

  it('bài lưu media_ids sai dạng (chuỗi, số, object, null) bị bỏ qua, không làm lỗi cả feed', async () => {
    const playable = await insertAsset('ready', [360]);
    const expected = await insertPost([playable]);
    // Staging 13/11: một bài lưu "uuid" thay vì ["uuid"] làm /api/v1/feed trả 500 cho mọi người suốt 10 giờ.
    await insertPost(playable);
    await insertPost(42);
    await insertPost({ id: playable });
    await insertPost(null);

    const page = await feed.getPage({ limit: 20, after: null, viewerId: null });

    expect(page.items.map((item) => item.postId)).toEqual([expected]);
    const hot = await feed.getPage({ limit: 20, after: null, viewerId: null, tab: 'hot' });
    expect(hot.items.map((item) => item.postId)).toEqual([expected]);
  });

  it('bài nhiều media thì lấy video đầu tiên phát được', async () => {
    const processing = await insertAsset('processing');
    const playable = await insertAsset('ready', [360, 540]);
    await insertPost([processing, playable]);

    const { items } = await feed.getPage({ limit: 20, after: null, viewerId: null });

    expect(items[0]?.video.hlsUrl).toContain(playable);
    expect(items[0]?.video.levels).toEqual([360, 540]);
  });

  describe('tab Dành cho bạn', () => {
    it('bài hơn điểm quá e² lần luôn đứng trên, seed nào cũng vậy: nhiều tương tác > mới chưa có tương tác > rất cũ chưa có tương tác', async () => {
      const asset = await insertAsset('ready', [360]);
      // Điểm gốc ≈ 2,46 > 0,25 > 0,014: mỗi bậc cách nhau hơn 7,4 lần nên hệ số ×0,37–×2,7 không đảo được.
      const popular = await insertPost([asset], { createdAt: daysAgo(0.05) });
      const freshQuiet = await insertPost([asset], { createdAt: daysAgo(0.05) });
      const ancientQuiet = await insertPost([asset], { createdAt: daysAgo(730) });
      await setCounts(popular, { likes: 1000 });

      for (const random of [0, 0.3, 0.6, 0.9]) {
        nextRandom = random;
        await expect(readAllPages(1)).resolves.toEqual([popular, freshQuiet, ancientQuiet]);
      }
    });

    it('bài có tương tác sát điểm nhau đổi chỗ theo seed: cùng seed thì cùng thứ tự qua các trang, seed khác thì đầu trang khác', async () => {
      const asset = await insertAsset('ready', [360]);
      const createdAt = daysAgo(0.5);
      const ids = await Promise.all(Array.from({ length: 8 }, () => insertPost([asset], { createdAt })));
      for (const id of ids) await setCounts(id, { likes: 3 });

      const orders = new Map<number, string[]>();
      for (const random of [0, 0.25, 0.5, 0.75]) {
        nextRandom = random;
        const order = await readAllPages(3);
        expect([...order].sort()).toEqual([...ids].sort());
        await expect(readAllPages(20)).resolves.toEqual(order);
        orders.set(random, order);
      }
      expect(new Set([...orders.values()].map((order) => order[0])).size).toBeGreaterThan(1);
    });

    it('bài cũ nhiều tương tác và bài mới ít tương tác thay nhau lên đầu theo seed', async () => {
      const asset = await insertAsset('ready', [360]);
      // Điểm gốc gần nhau (≈ 0,49 và 0,61), id cố định để kết quả theo từng seed không đổi giữa các lần chạy.
      const fresh = await insertPost([asset], { createdAt: daysAgo(0.05), id: FRESH_ID });
      const old = await insertPost([asset], { createdAt: daysAgo(9), id: OLD_ID });
      await setCounts(fresh, { likes: 2 });
      await setCounts(old, { likes: 200 });

      const firsts = new Set<string | undefined>();
      for (let seed = 0; seed < FEED_SEED_COUNT; seed++) {
        nextRandom = seed / FEED_SEED_COUNT;
        firsts.add((await readAllPages(1))[0]);
      }
      expect(firsts).toEqual(new Set([fresh, old]));
    });

    it('bài chưa có tương tác xếp ngẫu nhiên theo seed: cùng seed thì cùng thứ tự, sang trang không lặp không rớt; seed khác thì thứ tự khác', async () => {
      const asset = await insertAsset('ready', [360]);
      const ids = await Promise.all(Array.from({ length: 12 }, () => insertPost([asset])));

      nextRandom = 0;
      const seedZero = await readAllPages(5);
      const seedZeroAgain = await readAllPages(20);
      nextRandom = 0.5;
      const seedEight = await readAllPages(5);

      expect([...seedZero].sort()).toEqual([...ids].sort());
      expect(seedZeroAgain).toEqual(seedZero);
      expect([...seedEight].sort()).toEqual([...ids].sort());
      expect(seedEight).not.toEqual(seedZero);
    });
  });

  describe('tab hot', () => {
    it('hai bài cùng điểm: ẩn bình luận làm đổi thứ tự hot; xoá bình luận hidden không đổi bộ đếm', async () => {
      const asset = await insertAsset('ready', [360]);
      const first = await insertPost([asset], { createdAt: daysAgo(1) });
      const second = await insertPost([asset], { createdAt: daysAgo(2) });
      // first: 1 thích + 1 bình luận = 3 điểm; second: 2 thích = 2 điểm. Ẩn bình luận làm first còn 1 điểm.
      await setCounts(first, { likes: 1, comments: 1 });
      await setCounts(second, { likes: 2 });
      const commentId = randomUUID();
      await pool.query(
        "insert into content.comments (id, post_id, author_id, body) values ($1,$2,$3,'Bình luận')",
        [commentId, first, OWNER_ID],
      );
      await expect(readHotPages(20)).resolves.toEqual([first, second]);
      await visibility.execute({
        targetType: 'comment',
        targetId: commentId,
        action: 'hide',
        actorId: OWNER_ID,
        actorType: 'staff',
        reasonCode: 'HARASSMENT',
      });
      await expect(readHotPages(20)).resolves.toEqual([second, first]);
      await deleteComment.execute({ commentId, userId: OWNER_ID });
      expect(
        (await pool.query('select comment_count from content.posts where id=$1', [first])).rows[0]
          .comment_count,
      ).toBe(0);
      await expect(readHotPages(20)).resolves.toEqual([second, first]);
    });
    it('ẩn bài loại khỏi cả for_you và hot ngay sau transaction', async () => {
      const asset = await insertAsset('ready', [360]);
      const postId = await insertPost([asset]);
      for (const tab of ['for_you', 'hot'] as const)
        expect(
          (await feed.getPage({ tab, limit: 20, after: null, viewerId: null })).items.map(
            (item) => item.postId,
          ),
        ).toContain(postId);
      await visibility.execute({
        targetType: 'post',
        targetId: postId,
        action: 'hide',
        actorId: OWNER_ID,
        actorType: 'staff',
        reasonCode: 'OTHER',
      });
      for (const tab of ['for_you', 'hot'] as const)
        expect(
          (await feed.getPage({ tab, limit: 20, after: null, viewerId: null })).items.map(
            (item) => item.postId,
          ),
        ).not.toContain(postId);
    });
    const readHotPages = (limit: number) => readAllPages(limit, null, undefined, 'hot');

    it('xếp theo trọng số thích 1, bình luận 2, lưu 3, chia sẻ 4', async () => {
      const asset = await insertAsset('ready', [360]);
      const noEngagement = await insertPost([asset], { createdAt: daysAgo(1) });
      const threeLikes = await insertPost([asset], { createdAt: daysAgo(5) });
      const oneShare = await insertPost([asset], { createdAt: daysAgo(4) });
      const oneSave = await insertPost([asset], { createdAt: daysAgo(3) });
      const oneComment = await insertPost([asset], { createdAt: daysAgo(2) });
      await setCounts(threeLikes, { likes: 3 });
      await setCounts(oneShare, { shares: 1 });
      await setCounts(oneSave, { saves: 1 });
      await setCounts(oneComment, { comments: 1 });

      const ids = await readHotPages(20);
      expect(ids[0]).toBe(oneShare);
      // Một lưu và ba thích cùng 3 điểm: thứ tự giữa hai bài là ngẫu nhiên theo seed.
      expect(ids.slice(1, 3).sort()).toEqual([oneSave, threeLikes].sort());
      expect(ids.slice(3)).toEqual([oneComment, noEngagement]);
    });

    it('bằng điểm (kể cả 0 điểm) thì ngẫu nhiên theo seed, không còn mới nhất trước', async () => {
      const asset = await insertAsset('ready', [360]);
      const unscored = await Promise.all(
        Array.from({ length: 12 }, (_, i) => insertPost([asset], { createdAt: daysAgo(i / 10) })),
      );

      nextRandom = 0;
      const seedZero = await readHotPages(5);
      nextRandom = 0.5;
      const seedEight = await readHotPages(5);

      expect([...seedZero].sort()).toEqual([...unscored].sort());
      expect([...seedEight].sort()).toEqual([...unscored].sort());
      expect(seedEight).not.toEqual(seedZero);
      expect(seedZero).not.toEqual(unscored);
    });

    it('sang trang không lặp, không rớt bài khi nhiều bài trùng điểm và trùng thời điểm', async () => {
      const asset = await insertAsset('ready', [360]);
      // Giữ phần micro-giây để thử con trỏ khi trùng thời điểm.
      const createdAt = `${daysAgo(1).slice(0, 19)}.123456Z`;
      const sameScore = await Promise.all(
        Array.from({ length: 5 }, () => insertPost([asset], { createdAt })),
      );
      const top = await insertPost([asset], { createdAt: daysAgo(5) });
      await setCounts(top, { likes: 10 });

      const ids = await readHotPages(2);

      expect(ids[0]).toBe(top);
      expect(ids.slice(1).sort()).toEqual([...sameScore].sort());
    });

    it('vẫn lọc bài không phát được', async () => {
      const playable = await insertPost([await insertAsset('ready', [360])]);
      const processing = await insertPost([await insertAsset('processing')]);
      await setCounts(processing, { likes: 100 });

      await expect(readHotPages(20)).resolves.toEqual([playable]);
    });

    it(`chỉ xếp hạng bài trong ${HOT_WINDOW_DAYS} ngày gần đây; bài cũ hơn dù nhiều tương tác vẫn có ở for_you`, async () => {
      const asset = await insertAsset('ready', [360]);
      const recent = await insertPost([asset], { createdAt: daysAgo(HOT_WINDOW_DAYS - 1) });
      const old = await insertPost([asset], { createdAt: daysAgo(HOT_WINDOW_DAYS + 1) });
      await setCounts(old, { likes: 1_000 });

      await expect(readHotPages(20)).resolves.toEqual([recent]);
      expect(
        (await feed.getPage({ tab: 'for_you', limit: 20, after: null, viewerId: null })).items.map(
          (item) => item.postId,
        ),
      ).toContain(old);
    });
  });

  it('sang trang không lặp, không rớt bài khi nhiều bài trùng thời điểm tới micro-giây', async () => {
    const asset = await insertAsset('ready', [360]);
    const createdAt = '2026-11-05T10:00:00.123456Z';
    const sameTime = [
      await insertPost([asset], { createdAt }),
      await insertPost([asset], { createdAt }),
      await insertPost([asset], { createdAt }),
    ];
    // Cùng mili-giây nhưng khác micro-giây: cursor chỉ giữ mili-giây sẽ làm rớt bài này.
    const sameMillisecond = await insertPost([asset], { createdAt: '2026-11-05T10:00:00.123001Z' });

    // Trang tác giả vẫn mới nhất trước, nên thử con trỏ thời gian ở đó.
    const ids = await readAllPages(1, null, OWNER_ID);

    expect(ids.slice(0, 3).sort()).toEqual([...sameTime].sort());
    expect(ids[3]).toBe(sameMillisecond);
    expect(ids).toHaveLength(4);
  });

  it('trả trạng thái thích, lưu đúng người xem; khách nhận null', async () => {
    const asset = await insertAsset('ready', [360]);
    const liked = await insertPost([asset], { createdAt: '2026-11-03T00:00:00Z' });
    const saved = await insertPost([asset], { createdAt: '2026-11-02T00:00:00Z' });
    await pool.query(`insert into content.reactions (post_id, user_id, type) values ($1, $2, 'like')`, [
      liked,
      VIEWER_ID,
    ]);
    await pool.query('insert into content.bookmarks (post_id, user_id) values ($1, $2)', [saved, VIEWER_ID]);

    const viewerPage = await feed.getPage({ limit: 20, after: null, viewerId: VIEWER_ID });
    const otherPage = await feed.getPage({ limit: 20, after: null, viewerId: OWNER_ID });
    const guestPage = await feed.getPage({ limit: 20, after: null, viewerId: null });

    const stateOf = (page: typeof viewerPage) => Object.fromEntries(page.items.map((item) => [item.postId, item.viewerState]));
    expect(stateOf(viewerPage)).toEqual({
      [liked]: { liked: true, saved: false },
      [saved]: { liked: false, saved: true },
    });
    expect(stateOf(otherPage)).toEqual({
      [liked]: { liked: false, saved: false },
      [saved]: { liked: false, saved: false },
    });
    expect(guestPage.items.map((item) => item.viewerState)).toEqual([null, null]);
  });

  it('bài viết (vlog) cũ lỡ kèm video phát được vẫn không lọt vào feed Reels, cả for_you lẫn hot', async () => {
    const asset = await insertAsset('ready', [360]);
    const reel = await insertPost([asset]);
    await insertPost([asset], { postType: 'vlog' });

    const forYou = await feed.getPage({ limit: 20, after: null, viewerId: null });
    const hot = await feed.getPage({ tab: 'hot', limit: 20, after: null, viewerId: null });

    expect(forYou.items.map((item) => item.postId)).toEqual([reel]);
    expect(hot.items.map((item) => item.postId)).toEqual([reel]);
  });

  it('saved chỉ trả Reels phát được mà đúng người xem đã lưu, sang trang không lặp', async () => {
    const asset = await insertAsset('ready', [360]);
    const savedIds: string[] = [];
    for (const day of ['01', '02', '03']) {
      const id = await insertPost([asset], { createdAt: `2026-11-${day}T00:00:00Z` });
      await pool.query('insert into content.bookmarks (post_id, user_id) values ($1, $2)', [id, VIEWER_ID]);
      savedIds.unshift(id);
    }
    const notSaved = await insertPost([asset]);
    const savedByOther = await insertPost([asset]);
    await pool.query('insert into content.bookmarks (post_id, user_id) values ($1, $2)', [savedByOther, OWNER_ID]);
    const savedVlog = await insertPost([], { postType: 'vlog' });
    await pool.query('insert into content.bookmarks (post_id, user_id) values ($1, $2)', [savedVlog, VIEWER_ID]);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const after = cursor ? decodeFeedCursor(cursor) : null;
      const page = await feed.getPage({ limit: 2, after, viewerId: VIEWER_ID, isSavedOnly: true });
      expect(page.items.every((item) => item.viewerState?.saved === true)).toBe(true);
      ids.push(...page.items.map((item) => item.postId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(ids).toEqual(savedIds);
    expect(ids).not.toContain(notSaved);
  });
});
