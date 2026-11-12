import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import type { RawRow } from '../domain/contracts.js';
import { resolveAlgo } from '../domain/registry.js';
import { DrizzleRecommendStore } from './drizzle-recommend.store.js';

const U = randomUUID();
const NOW = new Date('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const row = (over: Partial<RawRow>): RawRow => ({
  actorType: 'user',
  actorId: U,
  kind: 'reaction',
  refId: 'r',
  targetType: 'post',
  targetId: null,
  value: null,
  isRemoved: false,
  detail: null,
  occurredAt: hoursAgo(1).toISOString(),
  ...over,
});

/** Câu SQL của store gợi ý trên Postgres thật: upsert chỉ ghi đè khi mới hơn, huỷ đơn, đếm, ứng viên, dọn hạn lưu. */
describe('DrizzleRecommendStore trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzleRecommendStore;
  const meta = () => ({ source: 'test', eventId: randomUUID() });

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('discovery');
    await migrateModule({ url, module: 'discovery', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 5, applicationName: 'discovery-recommend-int-test' });
    store = new DrizzleRecommendStore(createDb(pool));
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  beforeEach(async () => {
    await pool.query('truncate discovery.recommend_interactions, discovery.recommend_posts, discovery.recommend_post_scores, discovery.recommend_user_features');
  });

  it('migration seed for_you và trending, bộ ba hợp lệ', async () => {
    const algos = await store.listActiveAlgos();
    expect(algos.map((a) => a.name).sort()).toEqual(['for_you', 'trending']);
    for (const a of algos) expect(resolveAlgo(a).ok).toBe(true);
  });

  it('giao lại không ghi đôi; sự kiện cũ đến sau không đè dòng mới', async () => {
    const postId = randomUUID();
    const newer = row({ refId: postId, targetId: postId, detail: { type: 'love' }, occurredAt: hoursAgo(1).toISOString() });
    await store.upsertInteractions([newer], meta());
    await store.upsertInteractions([newer], meta());
    await store.upsertInteractions([{ ...newer, isRemoved: true, detail: { type: null }, occurredAt: hoursAgo(5).toISOString() }], meta());
    const { rows } = await pool.query('select is_removed, detail from discovery.recommend_interactions');
    expect(rows).toEqual([{ is_removed: false, detail: { type: 'love' } }]);

    // Gỡ mới hơn thì ghi đè.
    await store.upsertInteractions([{ ...newer, isRemoved: true, occurredAt: hoursAgo(0).toISOString() }], meta());
    expect((await pool.query('select is_removed from discovery.recommend_interactions')).rows).toEqual([{ is_removed: true }]);
  });

  it('huỷ đơn: gỡ mọi order_item của đơn xảy ra trước lúc huỷ, không đụng đơn khác', async () => {
    const orderId = randomUUID();
    const other = randomUUID();
    await store.upsertInteractions(
      [
        row({ kind: 'order_item', refId: `${orderId}:0`, targetType: 'room' }),
        row({ kind: 'order_item', refId: `${orderId}:1`, targetType: 'room' }),
        row({ kind: 'order_item', refId: `${other}:0`, targetType: 'room' }),
      ],
      meta(),
    );
    expect(await store.cancelOrderItems({ userId: U, orderId, occurredAt: NOW.toISOString() })).toBe(2);
    const { rows } = await pool.query('select ref_id from discovery.recommend_interactions where is_removed order by ref_id');
    expect(rows.map((r: { ref_id: string }) => r.ref_id)).toEqual([`${orderId}:0`, `${orderId}:1`]);
  });

  it('đếm tương tác theo bài: bỏ is_removed, bỏ dòng sau now, tách 24 giờ', async () => {
    const p = randomUUID();
    await store.upsertInteractions(
      [
        row({ refId: 'a', targetId: p, occurredAt: hoursAgo(2).toISOString() }),
        row({ actorId: randomUUID(), refId: 'a', targetId: p, occurredAt: hoursAgo(48).toISOString() }),
        row({ actorId: randomUUID(), refId: 'a', targetId: p, isRemoved: true }),
        row({ actorId: randomUUID(), refId: 'a', targetId: p, occurredAt: hoursAgo(-1).toISOString() }),
        row({ kind: 'comment', refId: 'c', targetId: p }),
      ],
      meta(),
    );
    expect((await store.countPostInteractions(NOW)).get(p)).toEqual({ d30: { reaction: 2, comment: 1 }, h24: { reaction: 1, comment: 1 } });
  });

  it('ứng viên hot phá hoà cố định; fresh gồm bài chưa có điểm; bỏ bài loại trừ', async () => {
    const author = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    await store.replacePosts(
      ids.map((postId, i) => ({ postId, authorId: author, postType: 'video', tags: ['dalat'], placeId: 'da-lat', isVerified: false, publishedAt: hoursAgo(i === 2 ? 1 : 100) })),
    );
    // Hai bài đầu cùng điểm 1, cùng giờ đăng → phá hoà bằng post_id desc. Bài 3 chưa có điểm.
    await store.replacePostScores('hot@v0', ids.slice(0, 2).map((postId) => ({ postId, postType: 'video', score: 1, features: {} })));
    const q = { postBuilder: 'hot@v0', postType: 'video', excludePostIds: [], limit: 10, now: NOW };
    expect((await store.listHotCandidates(q)).map((c) => c.postId)).toEqual([ids[1], ids[0]]);
    const fresh = await store.listFreshCandidates({ ...q, hours: 48 });
    expect(fresh).toEqual([expect.objectContaining({ postId: ids[2], score: 0, source: 'fresh', tags: ['dalat'] })]);
    expect((await store.listHotCandidates({ ...q, excludePostIds: [ids[1]!] })).map((c) => c.postId)).toEqual([ids[0]]);

    // post_type của hot đọc ở bảng điểm (index); đổi loại ở bảng điểm thì lọc theo đó.
    await pool.query(`update discovery.recommend_post_scores set post_type = 'vlog' where post_id = $1`, [ids[0]]);
    expect((await store.listHotCandidates({ ...q, postType: 'vlog' })).map((c) => c.postId)).toEqual([ids[0]]);

    // content tạm rỗng: không xoá sạch metadata.
    expect(await store.replacePosts([])).toBe(false);
    expect(await store.listExplorePool({ ...q, days: 30 })).toHaveLength(3);
  });

  it('dòng của người dùng, bài đã tương tác, đặc trưng người dùng', async () => {
    const p = randomUUID();
    await store.upsertInteractions([row({ refId: p, targetId: p }), row({ kind: 'search', refId: 'e', targetType: 'place', targetId: 'da-lat' })], meta());
    expect(await store.listActiveUserIds(NOW)).toEqual([U]);
    expect(await store.listDirtyUserIds(hoursAgo(-1000))).toEqual([]);
    expect((await store.listUserRows([U], NOW)).map((r) => r.kind).sort()).toEqual(['reaction', 'search']);
    expect(await store.listInteractedPostIds(U, NOW)).toEqual([p]);
    // Dòng sau now không tính (đánh giá cuốn theo ngày).
    await store.upsertInteractions([row({ refId: 'later', targetId: randomUUID(), occurredAt: hoursAgo(-1).toISOString() })], meta());
    expect(await store.listInteractedPostIds(U, NOW)).toEqual([p]);
    await store.upsertUserFeatures('tag_affinity@v0', [{ userId: U, features: { tags: { dalat: 1 } } }]);
    await store.upsertUserFeatures('tag_affinity@v0', [{ userId: U, features: { tags: { bien: 1 } } }]);
    expect(await store.findUserFeatures('tag_affinity@v0', U)).toEqual({ tags: { bien: 1 } });
  });

  it('số liệu admin: dòng nạp 10 phút/24 giờ, bài, người có gu, mốc builder; tra tag/nơi bài', async () => {
    const p = randomUUID();
    await store.replacePosts([{ postId: p, authorId: randomUUID(), postType: 'vlog', tags: ['dalat'], placeId: 'da-lat', isVerified: false, publishedAt: hoursAgo(2) }]);
    await store.upsertInteractions([row({ refId: 'a', targetId: p }), row({ refId: 'b', targetId: randomUUID() })], meta());
    await store.upsertUserFeatures('tag_affinity@v0', [{ userId: U, features: { tags: { dalat: 1 } } }]);
    await store.setJobState('hot@v0', { lastRunAt: NOW, lastError: 'boom' });
    const stats = await store.getAdminStats(new Date());
    expect(stats).toMatchObject({ interactionsLast10m: 2, interactionsLast24h: 2, posts: 1, usersWithFeatures: 1 });
    expect(stats.jobStates).toContainEqual({ name: 'hot@v0', lastRunAt: NOW, lastError: 'boom' });
    expect(await store.findPostMetas([p, randomUUID()])).toEqual([{ postId: p, authorId: expect.any(String), postType: 'vlog', tags: ['dalat'], placeId: 'da-lat' }]);
  });

  it('khoá advisory: lượt thứ hai cùng lúc bỏ lượt', async () => {
    let release!: () => void;
    const first = store.withLock('t', () => new Promise<string>((r) => (release = () => r('a'))));
    await new Promise((r) => setTimeout(r, 50));
    expect(await store.withLock('t', () => Promise.resolve('b'))).toBeNull();
    release();
    expect(await first).toBe('a');
    expect(await store.withLock('t', () => Promise.resolve('c'))).toBe('c');
  });

  it('dọn hạn lưu theo lô', async () => {
    const day = 24;
    await store.upsertInteractions(
      [
        row({ refId: 'removed-old', isRemoved: true, occurredAt: hoursAgo(8 * day).toISOString() }),
        row({ refId: 'removed-new', isRemoved: true, occurredAt: hoursAgo(6 * day).toISOString() }),
        row({ kind: 'search', refId: 'search-old', occurredAt: hoursAgo(91 * day).toISOString() }),
        row({ refId: 'reaction-91d', occurredAt: hoursAgo(91 * day).toISOString() }),
        row({ refId: 'reaction-old', occurredAt: hoursAgo(181 * day).toISOString() }),
      ],
      meta(),
    );
    expect(await store.purgeExpired(NOW, 2)).toBe(2);
    expect(await store.purgeExpired(NOW, 2)).toBe(1);
    expect(await store.purgeExpired(NOW, 2)).toBe(0);
    const { rows } = await pool.query('select ref_id from discovery.recommend_interactions order by ref_id');
    expect(rows.map((r: { ref_id: string }) => r.ref_id)).toEqual(['reaction-91d', 'removed-new']);
  });
});
