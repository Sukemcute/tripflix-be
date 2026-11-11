import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { comments, posts } from '../../db/schema/index.js';
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
});
