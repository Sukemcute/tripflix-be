import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { bookmarks, posts } from '../../db/schema/index.js';
import { BookmarkRepository } from './bookmark.repository.js';

describe('BookmarkRepository.findUserBookmarks lọc theo postType', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let repository: BookmarkRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'bookmark-repository-int-test' });
    db = createDb(pool);
    repository = new BookmarkRepository(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('chỉ trả bookmark của bài vlog, trang đủ số lượng dù xen kẽ Reels', async () => {
    const authorId = randomUUID();
    const userId = randomUUID();
    const insertedPosts = await db
      .insert(posts)
      .values([
        { authorId, postType: 'vlog', title: 'Bài viết 1' },
        { authorId, postType: 'video', title: 'Reels 1' },
        { authorId, postType: 'vlog', title: 'Bài viết 2' },
        { authorId, postType: 'video', title: 'Reels 2' },
      ])
      .returning();
    const base = Date.parse('2026-11-12T00:00:00Z');
    await db.insert(bookmarks).values(
      insertedPosts.map((post, index) => ({
        postId: post.id,
        userId,
        createdAt: new Date(base + index * 1000),
      })),
    );
    const vlogIds = insertedPosts.filter((post) => post.postType === 'vlog').map((post) => post.id);

    const vlogOnly = await repository.findUserBookmarks({ userId, limit: 2, postType: 'vlog' });
    expect(vlogOnly.map((bookmark) => bookmark.postId).sort()).toEqual([...vlogIds].sort());

    const everything = await repository.findUserBookmarks({ userId, limit: 10 });
    expect(everything).toHaveLength(4);
  });
});
