import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { posts } from '../../db/schema/index.js';
import { PostRepository } from './post.repository.js';

describe('PostRepository.findVisibleIds', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 2, applicationName: 'post-repository-int-test' });
    db = createDb(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('chỉ trả bài published + public chưa xoá, cùng điều kiện với ContentFacade.getVisiblePosts', async () => {
    const authorId = randomUUID();
    const rows = await db
      .insert(posts)
      .values([
        { authorId, postType: 'vlog', title: 'hiện', status: 'published', visibility: 'public' },
        { authorId, postType: 'vlog', title: 'nháp', status: 'draft', visibility: 'public' },
        { authorId, postType: 'vlog', title: 'riêng tư', status: 'published', visibility: 'private' },
        { authorId, postType: 'vlog', title: 'đã xoá', status: 'published', visibility: 'public', deletedAt: new Date() },
      ])
      .returning({ id: posts.id });

    const visible = await new PostRepository(db).findVisibleIds([...rows.map((r) => r.id), randomUUID()]);

    expect(visible).toEqual([rows[0]!.id]);
  });
});
