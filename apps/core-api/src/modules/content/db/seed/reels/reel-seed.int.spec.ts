import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { CATALOG_SEED_FILE } from '../../../../commerce/db/seed/seed-catalog.js';
import type { ReelCatalogFlight, ReelCatalogHotel } from './generate-reels.js';
import { buildReelSeed, seedReels } from './reel-seed.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));
const catalog = JSON.parse(readFileSync(CATALOG_SEED_FILE, 'utf8')) as { hotels: ReelCatalogHotel[]; flights: ReelCatalogFlight[] };
const users = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const REAL_USER = '99999999-0000-4000-8000-000000000001';

/** Seed reel mẫu trên Postgres thật: seed lại khi dữ liệu sinh đã đổi không vướng khoá (bài, người). */
describe('Seed reel mẫu (Postgres thật)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({ url, module: 'content', migrationsFolder: MIGRATIONS_FOLDER });
    pool = createPool({ url, max: 2, applicationName: 'reel-seed-int-test' });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('seed lại với người đăng, tương tác khác vẫn chạy, giữ tương tác của người dùng thật, số đếm khớp', async () => {
    const db = createDb(pool);
    const first = buildReelSeed({ authorIds: users, hotels: catalog.hotels, flights: catalog.flights });
    await seedReels(db, first);
    const postId = first.posts[0]!.id;
    await pool.query(`insert into content.reactions (id, post_id, user_id, type) values (gen_random_uuid(), $1, $2, 'like')`, [postId, REAL_USER]);

    // Cùng tài khoản nhưng thứ tự khác => cùng id bài, id cảm xúc nhưng người đăng, cặp (bài, người) đổi.
    const second = buildReelSeed({ authorIds: [...users].reverse(), hotels: catalog.hotels, flights: catalog.flights });
    await expect(seedReels(db, second)).resolves.toMatchObject({ posts: 1000 });

    const { rows } = await pool.query<{ posts: number; owner_mismatch: number; self_like: number; count_mismatch: number; real_kept: number; reactions: number }>(`
      select
        (select count(*)::int from content.posts) as posts,
        (select count(*)::int from content.posts p join content.media_assets m on m.id = (p.media_ids->>0)::uuid where m.owner_id <> p.author_id) as owner_mismatch,
        (select count(*)::int from content.reactions r join content.posts p on p.id = r.post_id where r.user_id = p.author_id) as self_like,
        (select count(*)::int from content.posts p where p.reaction_total <> (select count(*) from content.reactions r where r.post_id = p.id)) as count_mismatch,
        (select count(*)::int from content.reactions where user_id = '${REAL_USER}') as real_kept,
        (select count(*)::int from content.reactions) as reactions`);
    expect(rows[0]).toEqual({
      posts: 1000,
      owner_mismatch: 0,
      self_like: 0,
      count_mismatch: 0,
      real_kept: 1,
      reactions: second.reactions.length + 1,
    });
    const authors = await pool.query<{ id: string; author_id: string }>('select id, author_id from content.posts');
    const expected = new Map(second.posts.map((p) => [p.id, p.authorId]));
    expect(authors.rows.every((row) => expected.get(row.id) === row.author_id)).toBe(true);
  }, 300_000);
});
