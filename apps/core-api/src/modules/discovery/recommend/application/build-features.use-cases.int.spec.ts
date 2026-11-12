import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { DrizzleRecommendStore } from '../infra/drizzle-recommend.store.js';
import { BuildFeaturesUseCases } from './build-features.use-cases.js';
import type { RecommendCatalog, RecommendSourcePost } from './ports.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const U = randomUUID();
const AUTHOR = randomUUID();

const post = (title: string, over: Partial<RecommendSourcePost> = {}): RecommendSourcePost => ({
  id: randomUUID(),
  authorId: AUTHOR,
  postType: 'video',
  title,
  hashtags: [],
  isVerified: false,
  tripAttachment: null,
  createdAt: hoursAgo(10),
  ...over,
});

/** Một chu kỳ bộ điều phối trên Postgres thật, catalog giả (content/commerce là module khác). */
describe('BuildFeaturesUseCases trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleRecommendStore;
  let posts: RecommendSourcePost[];

  const catalog: RecommendCatalog = {
    // Lật 2 trang để kiểm đọc hết.
    listPosts: (cursor) => Promise.resolve(cursor ? { items: posts.slice(1), nextCursor: null } : { items: posts.slice(0, 1), nextCursor: posts.length > 1 ? 'p2' : null }),
    listHotelProvinces: () => Promise.resolve({ items: [{ id: 'H-DL', provinceSlug: 'lam-dong' }], nextCursor: null }),
  };

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('discovery');
    await migrateModule({ url, module: 'discovery', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'discovery-build-features-int-test' });
    store = new DrizzleRecommendStore(createDb(pool));
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('một chu kỳ: đồng bộ bài + placeId, điểm hot cả lô, gu người dùng, mốc job', async () => {
    const dalat = post('Săn mây Đà Lạt', { hashtags: ['dalat', 'sanmay'] });
    const hotel = post('Nghỉ dưỡng', { tripAttachment: { hotelId: 'H-DL' } });
    const fresh = post('Ăn gì hôm nay', { postType: 'vlog', createdAt: hoursAgo(1) });
    posts = [dalat, hotel, fresh];
    await store.upsertInteractions(
      [
        { actorType: 'user', actorId: U, kind: 'reaction', refId: dalat.id, targetType: 'post', targetId: dalat.id, value: null, isRemoved: false, detail: null, occurredAt: hoursAgo(2).toISOString() },
        { actorType: 'user', actorId: U, kind: 'search', refId: 'e1', targetType: 'place', targetId: 'da-lat', value: null, isRemoved: false, detail: null, occurredAt: hoursAgo(1).toISOString() },
      ],
      { source: 'test', eventId: randomUUID() },
    );

    const result = await new BuildFeaturesUseCases(store, catalog).runCycle(NOW);
    expect(result).toEqual({ posts: 3, users: 1, failedBuilders: [] });

    const places = await pool.query('select post_id, place_id from discovery.recommend_posts');
    expect(Object.fromEntries(places.rows.map((r: { post_id: string; place_id: string | null }) => [r.post_id, r.place_id]))).toEqual({
      [dalat.id]: 'da-lat',
      [hotel.id]: 'lam-dong',
      [fresh.id]: null,
    });

    const scores = await pool.query(`select post_id, post_type, score from discovery.recommend_post_scores where builder = 'hot' and version = 'v0'`);
    expect(scores.rows).toHaveLength(3);
    expect(scores.rows.find((r: { post_id: string }) => r.post_id === dalat.id)).toMatchObject({ score: 1, post_type: 'video' });

    const tagAffinity = await store.findUserFeatures('tag_affinity@v0', U);
    expect(tagAffinity).toMatchObject({ tags: { dalat: 1, sanmay: 1 }, places: { 'da-lat': 1 }, interactionCount: 2 });
    expect(await store.findUserFeatures('none@v0', U)).toEqual({});

    const state = await pool.query(`select name, last_error from discovery.recommend_job_state order by name`);
    expect(state.rows).toEqual([
      { name: 'build-features', last_error: null },
      { name: 'hot@v0', last_error: null },
      { name: 'none@v0', last_error: null },
      { name: 'tag_affinity@v0', last_error: null },
    ]);
  });

  it('content tạm rỗng: bỏ lượt, giữ dữ liệu cũ', async () => {
    posts = [];
    expect(await new BuildFeaturesUseCases(store, catalog).runCycle(NOW)).toBeNull();
    expect((await pool.query('select count(*)::int as n from discovery.recommend_posts')).rows[0].n).toBe(3);
  });

  it('worker khác đang giữ khoá: bỏ lượt', async () => {
    posts = [post('x')];
    let release!: () => void;
    const holding = store.withLock('discovery.recommend-features', () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 50));
    expect(await new BuildFeaturesUseCases(store, catalog).runCycle(NOW)).toBeNull();
    release();
    await holding;
  });
});
