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
import { HOT_WINDOW_DAYS } from '../domain/hot-score.js';
import { DrizzleFeedStore } from '../infra/drizzle-feed.store.js';
import { FeedUseCases } from './feed.use-cases.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_ID = '22222222-2222-4222-8222-222222222222';

/** Câu truy vấn của feed trên Postgres thật, gồm cả điều kiện lọc jsonb và so sánh cursor. */
describe('Feed trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let feed: FeedUseCases;
  let moduleRef: TestingModule;
  let visibility: ChangeVisibilityUseCase;
  let deleteComment: DeleteCommentUseCase;

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
    mediaIds: string[],
    options: {
      status?: string;
      visibility?: string;
      createdAt?: string;
      deleted?: boolean;
      postType?: 'video' | 'vlog';
    } = {},
  ) {
    const id = randomUUID();
    await pool.query(
      `insert into content.posts (id, author_id, post_type, title, status, visibility, media_ids, created_at, deleted_at)
       values ($1, $2, $8, 'Bài', $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
      [
        id,
        OWNER_ID,
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

  async function readAllPages(limit: number, viewerId: string | null = null) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const after = cursor ? decodeFeedCursor(cursor) : null;
      const page = await feed.getPage({ limit, after, viewerId });
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
    );
  }, 120_000);

  beforeEach(async () => {
    await pool.query('truncate content.posts, content.media_assets cascade');
  });

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    await postgres?.stop();
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

  it('bài nhiều media thì lấy video đầu tiên phát được', async () => {
    const processing = await insertAsset('processing');
    const playable = await insertAsset('ready', [360, 540]);
    await insertPost([processing, playable]);

    const { items } = await feed.getPage({ limit: 20, after: null, viewerId: null });

    expect(items[0]?.video.hlsUrl).toContain(playable);
    expect(items[0]?.video.levels).toEqual([360, 540]);
  });

  it('xếp mới nhất trước', async () => {
    const asset = await insertAsset('ready', [360]);
    const oldest = await insertPost([asset], { createdAt: '2026-11-01T00:00:00Z' });
    const newest = await insertPost([asset], { createdAt: '2026-11-03T00:00:00Z' });
    const middle = await insertPost([asset], { createdAt: '2026-11-02T00:00:00Z' });

    await expect(readAllPages(20)).resolves.toEqual([newest, middle, oldest]);
  });

  describe('tab hot', () => {
    // Tab hot chỉ xếp hạng bài trong HOT_WINDOW_DAYS ngày gần đây, nên ngày tạo bài tính lùi từ hôm nay.
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

    it('hai bài cùng điểm: ẩn bình luận làm đổi thứ tự hot; xoá bình luận hidden không đổi bộ đếm', async () => {
      const asset = await insertAsset('ready', [360]);
      const first = await insertPost([asset], { createdAt: daysAgo(1) });
      const second = await insertPost([asset], { createdAt: daysAgo(2) });
      await setCounts(first, { comments: 1 });
      await setCounts(second, { comments: 1 });
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
    async function setCounts(
      postId: string,
      counts: { likes?: number; comments?: number; saves?: number; shares?: number },
    ) {
      await pool.query(
        'update content.posts set reaction_total = $2, comment_count = $3, bookmark_count = $4, share_count = $5 where id = $1',
        [postId, counts.likes ?? 0, counts.comments ?? 0, counts.saves ?? 0, counts.shares ?? 0],
      );
    }

    async function readHotPages(limit: number) {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const after = cursor ? decodeFeedCursor(cursor) : null;
        const page = await feed.getPage({ tab: 'hot', limit, after, viewerId: null });
        ids.push(...page.items.map((item) => item.postId));
        cursor = page.nextCursor;
      } while (cursor);
      return ids;
    }

    it('xếp theo trọng số thích 1, bình luận 2, lưu 3, chia sẻ 4; bằng điểm thì mới nhất trước', async () => {
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

      await expect(readHotPages(20)).resolves.toEqual([
        oneShare,
        oneSave,
        threeLikes,
        oneComment,
        noEngagement,
      ]);
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

    const ids = await readAllPages(1);

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

    expect(viewerPage.items.map((item) => item.viewerState)).toEqual([
      { liked: true, saved: false },
      { liked: false, saved: true },
    ]);
    expect(otherPage.items.map((item) => item.viewerState)).toEqual([
      { liked: false, saved: false },
      { liked: false, saved: false },
    ]);
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
