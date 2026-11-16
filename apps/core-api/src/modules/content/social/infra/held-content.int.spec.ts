import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { comments, posts } from '../../db/schema/index.js';
import { DrizzleFeedStore } from '../../feed/infra/drizzle-feed.store.js';
import { CommentRepository } from './comment.repository.js';
import { PostRepository } from './post.repository.js';

/**
 * Bài và bình luận `held` (luật nhanh giữ lại chờ kiểm duyệt, TF90) không được lọt ra chỗ đọc công khai:
 * bảng tin, đồng bộ tìm kiếm, Reels, danh sách/đếm/lấy mẫu bình luận. Tác giả vẫn thấy bài của mình.
 */
describe('Nội dung held không lọt ra chỗ đọc công khai (TF90)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: ReturnType<typeof createDb>;
  let postRepository: PostRepository;
  let commentRepository: CommentRepository;
  let feedStore: DrizzleFeedStore;

  const authorId = randomUUID();
  const commenterId = randomUUID();
  let publishedPostId: string;
  let heldPostId: string;
  let publishedReelId: string;
  let heldReelId: string;
  let visibleCommentId: string;
  let heldCommentId: string;

  async function insertPlayableVideo(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into content.media_assets (id, owner_id, status, mime_type, file_size_bytes, source_key, hls_prefix, aspect, duration_sec)
       values ($1, $2, 'ready', 'video/mp4', 1, $3, $4, '9:16', 40)`,
      [id, authorId, `dev/test/uploads/${id}/original.mp4`, `dev/test/videos/${id}/r1`],
    );
    await pool.query('insert into content.renditions (asset_id, level) values ($1, 720)', [id]);
    return id;
  }

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'held-content-int-test' });
    db = createDb(pool);
    postRepository = new PostRepository(db);
    commentRepository = new CommentRepository(db);
    feedStore = new DrizzleFeedStore(() => db);

    const publishedAt = new Date();
    const videoId = await insertPlayableVideo();
    const inserted = await db
      .insert(posts)
      .values([
        { authorId, postType: 'vlog', title: 'Bài công khai', body: 'Đà Lạt', status: 'published', publishedAt },
        { authorId, postType: 'vlog', title: 'Bài đang giữ', body: 'ck trước qua stk', status: 'held', publishedAt },
        { authorId, postType: 'video', title: 'Reels công khai', status: 'published', publishedAt, mediaIds: [videoId] },
        { authorId, postType: 'video', title: 'Reels đang giữ', status: 'held', publishedAt, mediaIds: [videoId] },
      ])
      .returning();
    [publishedPostId, heldPostId, publishedReelId, heldReelId] = inserted.map((post) => post.id) as [
      string,
      string,
      string,
      string,
    ];

    const insertedComments = await db
      .insert(comments)
      .values([
        { postId: publishedPostId, authorId: commenterId, body: 'Đẹp quá', status: 'visible' },
        { postId: publishedPostId, authorId: commenterId, body: 'tao biết nhà mày ở đâu', status: 'held' },
      ])
      .returning();
    [visibleCommentId, heldCommentId] = insertedComments.map((comment) => comment.id) as [string, string];
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('bảng tin công khai và đồng bộ tìm kiếm không có bài held', async () => {
    const publicIds = (await postRepository.findPublicPosts({ limit: 50 })).map((post) => post.id);
    expect(publicIds).toContain(publishedPostId);
    expect(publicIds).not.toContain(heldPostId);
    expect(publicIds).not.toContain(heldReelId);

    const syncIds = (await postRepository.findPostsForSync({ limit: 50 })).map((post) => post.id);
    expect(syncIds).toContain(publishedPostId);
    expect(syncIds).not.toContain(heldPostId);
  });

  it('Reels không phát bài held dù video đã sẵn sàng', async () => {
    const rows = await feedStore.findPlayablePostsByIds([publishedReelId, heldReelId]);
    expect(rows.map((row) => row.id)).toEqual([publishedReelId]);
  });

  it('tác giả vẫn thấy bài held trong danh sách bài của mình', async () => {
    const mine = (await postRepository.findUserPosts({ authorId, limit: 50, status: 'all' })).map((post) => post.id);
    expect(mine).toEqual(expect.arrayContaining([publishedPostId, heldPostId, publishedReelId, heldReelId]));
  });

  it('bình luận held không có trong danh sách, đếm, lấy mẫu và thống kê bình luận', async () => {
    const listed = await commentRepository.findByPostId({ postId: publishedPostId, limit: 50, flat: true });
    expect(listed.map((comment) => comment.id)).toEqual([visibleCommentId]);

    expect(await commentRepository.countByPostId(publishedPostId, { flat: true })).toBe(1);
    expect(await commentRepository.findVisibleIds(publishedPostId, [visibleCommentId, heldCommentId])).toEqual([
      visibleCommentId,
    ]);

    const sampled = await commentRepository.sampleComments({ postId: publishedPostId, size: 10 });
    expect(sampled.map((comment) => comment.id)).not.toContain(heldCommentId);

    expect(await commentRepository.getCommentStats(publishedPostId)).toEqual({
      visibleCommentCount: 1,
      uniqueAuthorCount: 1,
    });
  });

  it('ràng buộc ck_comments_status nhận held, vẫn chặn trạng thái lạ', async () => {
    await expect(
      pool.query(`insert into content.comments (post_id, author_id, body, status) values ($1, $2, 'x', 'pending')`, [
        publishedPostId,
        commenterId,
      ]),
    ).rejects.toThrow(/ck_comments_status/);
  });
});
