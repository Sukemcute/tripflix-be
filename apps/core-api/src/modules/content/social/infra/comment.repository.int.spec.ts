import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { commentReactions, comments, posts } from '../../db/schema/index.js';
import { CommentRepository } from './comment.repository.js';

describe('CommentRepository.countRepliesByParentIds', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let repository: CommentRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'comment-repository-int-test' });
    db = createDb(pool);
    repository = new CommentRepository(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('chỉ đếm trả lời còn hiển thị, bình luận không có trả lời thì không có trong kết quả', async () => {
    const authorId = randomUUID();
    const [post] = await db.insert(posts).values({ authorId, postType: 'vlog', title: 'Bài thử' }).returning();
    const postId = post!.id;
    const [withReplies, withoutReplies] = await db
      .insert(comments)
      .values([
        { postId, authorId, body: 'Có trả lời' },
        { postId, authorId, body: 'Chưa ai trả lời' },
      ])
      .returning();
    const parentCommentId = withReplies!.id;
    await db.insert(comments).values([
      { postId, authorId, body: 'Trả lời 1', parentCommentId },
      { postId, authorId, body: 'Trả lời 2', parentCommentId },
      { postId, authorId, body: 'Đã xoá', parentCommentId, deletedAt: new Date() },
      { postId, authorId, body: 'Bị ẩn', parentCommentId, status: 'hidden' },
    ]);

    const counts = await repository.countRepliesByParentIds([parentCommentId, withoutReplies!.id]);

    expect([...counts]).toEqual([[parentCommentId, 2]]);
    expect(await repository.countRepliesByParentIds([])).toEqual(new Map());
  });

  it('findPage: một câu trả trang kèm số trả lời (như countRepliesByParentIds) và trạng thái thích theo người xem', async () => {
    const authorId = randomUUID();
    const viewerId = randomUUID();
    const [post] = await db.insert(posts).values({ authorId, postType: 'vlog', title: 'Bài thử findPage' }).returning();
    const postId = post!.id;
    const [older, newer] = await db
      .insert(comments)
      .values([
        { postId, authorId, body: 'Cũ hơn', createdAt: new Date('2026-11-16T08:00:00.000Z') },
        { postId, authorId, body: 'Mới hơn', createdAt: new Date('2026-11-16T08:00:01.000Z') },
      ])
      .returning();
    await db.insert(comments).values([
      { postId, authorId, body: 'Trả lời', parentCommentId: older!.id },
      { postId, authorId, body: 'Trả lời bị ẩn', parentCommentId: older!.id, status: 'hidden' },
      { postId, authorId, body: 'Trả lời đã xoá', parentCommentId: older!.id, deletedAt: new Date() },
      { postId, authorId: viewerId, body: 'Đang chờ kiểm tra', status: 'held', createdAt: new Date('2026-11-16T08:00:02.000Z') },
    ]);
    await db.insert(commentReactions).values({ commentId: newer!.id, userId: viewerId });

    const asViewer = await repository.findPage({ postId, limit: 10, viewerId });
    const asGuest = await repository.findPage({ postId, limit: 10 });
    const replyCounts = await repository.countRepliesByParentIds([older!.id, newer!.id]);

    // Bình luận held chỉ tác giả của nó thấy; trang chỉ có bình luận gốc, mới trước.
    expect(asViewer.map((c) => [c.body, c.replyCount, c.isLiked])).toEqual([
      ['Đang chờ kiểm tra', 0, false],
      ['Mới hơn', 0, true],
      ['Cũ hơn', 1, false],
    ]);
    expect(asViewer.find((c) => c.id === older!.id)!.replyCount).toBe(replyCounts.get(older!.id));
    expect(asGuest.map((c) => [c.body, c.isLiked])).toEqual([
      ['Mới hơn', false],
      ['Cũ hơn', false],
    ]);
  });

  it('chỉ cho tác giả xem bình luận hidden/removed, và không tính chúng cho người xem khác', async () => {
    const firstAuthorId = randomUUID();
    const secondAuthorId = randomUUID();
    const otherViewerId = randomUUID();
    const [post] = await db.insert(posts).values({ authorId: firstAuthorId, postType: 'vlog', title: 'Bài thử ẩn comment' }).returning();
    const postId = post!.id;
    await db.insert(comments).values([
      { postId, authorId: firstAuthorId, body: 'Bình luận của tôi đã ẩn', status: 'hidden' },
      { postId, authorId: firstAuthorId, body: 'Bình luận của tôi đã gỡ', status: 'removed' },
      { postId, authorId: secondAuthorId, body: 'Bình luận người khác đã ẩn', status: 'hidden' },
      { postId, authorId: secondAuthorId, body: 'Bình luận người khác đã gỡ', status: 'removed' },
      { postId, authorId: secondAuthorId, body: 'Bình luận công khai' },
    ]);

    const asAuthor = await repository.findPage({ postId, limit: 10, viewerId: firstAuthorId });
    const asOtherViewer = await repository.findPage({ postId, limit: 10, viewerId: otherViewerId });
    const asGuest = await repository.findPage({ postId, limit: 10 });

    expect(asAuthor.map((comment) => comment.body).sort()).toEqual([
      'Bình luận công khai',
      'Bình luận của tôi đã gỡ',
      'Bình luận của tôi đã ẩn',
    ]);
    expect(asOtherViewer.map((comment) => comment.body)).toEqual(['Bình luận công khai']);
    expect(asGuest.map((comment) => comment.body)).toEqual(['Bình luận công khai']);
    await expect(repository.countByPostId(postId, { viewerId: firstAuthorId })).resolves.toBe(3);
    await expect(repository.countByPostId(postId, { viewerId: otherViewerId })).resolves.toBe(1);
  });
});
