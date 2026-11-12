import { hotV0, percentile } from './builders/hot.js';
import { noneV0 } from './builders/none.js';
import { tagAffinityV0 } from './builders/tag-affinity.js';
import { interleave, mergeCandidates, pickExplore } from './candidates.js';
import type { Candidate, PostBuildItem, RawRow } from './contracts.js';
import { popularRankerV0, tagAffinityRankerV0 } from './rankers/rankers.js';
import { BUILDERS, RANKERS, resolveAlgo } from './registry.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const post = (postId: string, over: Partial<PostBuildItem> = {}): PostBuildItem => ({
  postId,
  authorId: 'a1',
  postType: 'video',
  tags: [],
  placeId: null,
  publishedAt: hoursAgo(10),
  interactions: {},
  interactions24h: {},
  ...over,
});

const row = (over: Partial<RawRow>): RawRow => ({
  actorType: 'user',
  actorId: 'u1',
  kind: 'reaction',
  refId: 'r',
  targetType: null,
  targetId: null,
  value: null,
  isRemoved: false,
  detail: null,
  occurredAt: hoursAgo(0),
  ...over,
});

const cand = (postId: string, over: Partial<Candidate> = {}): Candidate => ({
  postId,
  authorId: postId,
  postType: 'video',
  tags: [],
  placeId: null,
  score: 0,
  postFeatures: {},
  source: 'hot',
  ...over,
});

describe('percentile', () => {
  it('nội suy tuyến tính như numpy', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([0, 10], 99)).toBeCloseTo(9.9);
    expect(percentile([], 99)).toBe(0);
  });
});

describe('hot@v0', () => {
  it('chuẩn hoá theo p99 cả lô, kẹp ở 1, bài 0 tương tác = 0', async () => {
    const items = [
      post('p1', { interactions: { reaction: 10, comment: 2 }, interactions24h: { reaction: 3 } }),
      post('p2', { interactions: { reaction: 1 } }),
      post('p3'),
    ];
    const out = await hotV0.build(items, NOW);
    const byId = Object.fromEntries(out.map((o) => [o.postId, o]));
    expect(byId.p1!.score).toBe(1);
    expect(byId.p2!.score).toBeGreaterThan(0);
    expect(byId.p2!.score).toBeLessThan(1);
    expect(byId.p3!.score).toBe(0);
    expect(byId.p1!.features).toEqual({ reactions: 10, comments: 2, shares: 0, bookmarks: 0, velocity24h: 3, ageHours: 10 });
    for (const o of out) expect(hotV0.featuresSchema.safeParse(o.features).success).toBe(true);
  });

  it('cùng tương tác thì bài mới hơn điểm cao hơn', async () => {
    const out = await hotV0.build(
      [post('new', { interactions: { reaction: 5 } }), post('old', { publishedAt: hoursAgo(100), interactions: { reaction: 5 } }), post('x', { interactions: { share: 50 } })],
      NOW,
    );
    const s = Object.fromEntries(out.map((o) => [o.postId, o.score]));
    expect(s.new!).toBeGreaterThan(s.old!);
  });

  it('lô rỗng hoặc mọi bài 0 tương tác: không chia cho 0', async () => {
    expect(await hotV0.build([], NOW)).toEqual([]);
    expect((await hotV0.build([post('p')], NOW))[0]!.score).toBe(0);
  });
});

describe('tag_affinity@v0', () => {
  const posts = {
    p1: { postId: 'p1', authorId: 'a', postType: 'video', tags: ['DaLat', 'cafe'], placeId: 'da-lat' },
    p2: { postId: 'p2', authorId: 'a', postType: 'vlog', tags: ['bien'], placeId: 'nha-trang' },
  };

  it('cộng trọng số theo kind và bán rã, chia cho max, bỏ dòng isRemoved', async () => {
    const [out] = await tagAffinityV0.build(
      [
        {
          userId: 'u1',
          posts,
          productPlaces: { H1: 'phu-quoc' },
          rows: [
            row({ kind: 'reaction', targetType: 'post', targetId: 'p1' }),
            row({ kind: 'comment', targetType: 'post', targetId: 'p1', refId: 'c1' }),
            // 14 ngày trước: bán rã một nửa.
            row({ kind: 'reaction', targetType: 'post', targetId: 'p2', occurredAt: hoursAgo(14 * 24) }),
            row({ kind: 'reaction', targetType: 'post', targetId: 'p2', refId: 'x', isRemoved: true }),
            row({ kind: 'search', targetType: 'place', targetId: 'da-lat', refId: 'e1' }),
            row({ kind: 'order_item', targetType: 'room', targetId: 'H1', refId: 'o:0' }),
          ],
        },
      ],
      NOW,
    );
    const f = out!.features as Record<string, Record<string, number>>;
    // p1: 1 + 2 = 3, p2: 0.5
    expect(f.tags).toEqual({ dalat: 1, cafe: 1, bien: round(0.5 / 3) });
    // da-lat: 3 + 2 = 5; phu-quoc: 5; nha-trang: 0.5
    expect(f.places).toEqual({ 'da-lat': 1, 'phu-quoc': 1, 'nha-trang': 0.1 });
    expect(f.postTypes).toEqual({ video: 1, vlog: round(0.5 / 3) });
    expect(out!.features.interactionCount).toBe(5);
    expect(out!.features.homePlace).toBeNull();
    expect(tagAffinityV0.featuresSchema.safeParse(out!.features).success).toBe(true);
  });

  it('đơn có sourcePostId góp vào gu của bài đó', async () => {
    const [out] = await tagAffinityV0.build(
      [{ userId: 'u1', posts, productPlaces: {}, rows: [row({ kind: 'order_item', targetType: 'room', targetId: 'H9', detail: { sourcePostId: 'p2' } })] }],
      NOW,
    );
    expect((out!.features as { tags: Record<string, number> }).tags).toEqual({ bien: 1 });
  });

  it('none@v0 trả features rỗng', async () => {
    expect(await noneV0.build([{ userId: 'u1', rows: [], posts: {}, productPlaces: {} }], NOW)).toEqual([{ userId: 'u1', features: {} }]);
  });
});

const round = (x: number) => Math.round(x * 10_000) / 10_000;

describe('tag_affinity_v0', () => {
  const user = { tags: { dalat: 0.9, cafe: 0.5, bien: 0.1 }, places: { 'lam-dong': 1 } };

  it('final = 0.5·tagMatch + 0.2·placeMatch + 0.3·hot (ví dụ đề xuất 5.3)', () => {
    const [item] = tagAffinityRankerV0.rank({ candidates: [cand('p1', { tags: ['dalat', 'cafe', 'sanmay'], placeId: 'lam-dong', score: 0.82 })], userFeatures: user, now: NOW });
    expect(item!.breakdown).toEqual({ tagMatch: round(1.4 / 3), placeMatch: 1, hot: 0.82, final: round(0.5 * (1.4 / 3) + 0.2 + 0.3 * 0.82) });
    expect(item!.reason.code).toBe('matches_place');
    expect(item!.reason.text).toBe('Vì bạn quan tâm Lâm Đồng');
  });

  it('bài khớp gu vượt bài hot hơn; không có gu thì sắp theo hot', () => {
    const candidates = [cand('hot', { score: 0.9 }), cand('dl', { tags: ['dalat', 'cafe'], placeId: 'lam-dong', score: 0.1 })];
    expect(tagAffinityRankerV0.rank({ candidates, userFeatures: user, now: NOW }).map((r) => r.postId)).toEqual(['dl', 'hot']);
    const guest = tagAffinityRankerV0.rank({ candidates, userFeatures: null, now: NOW });
    expect(guest.map((r) => r.postId)).toEqual(['hot', 'dl']);
    expect(guest[0]!.reason.code).toBe('trending');
  });

  it('tối đa 2 bài/tác giả, dư dồn cuối; hoà điểm phá bằng postId', () => {
    const candidates = ['a', 'b', 'c', 'd'].map((id) => cand(id, { authorId: id === 'd' ? 'other' : 'same', score: 0.5 }));
    expect(popularRankerV0.rank({ candidates, userFeatures: null, now: NOW }).map((r) => r.postId)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('chỉ trả đúng ứng viên được đưa vào: lọc hết thì rỗng', () => {
    expect(tagAffinityRankerV0.rank({ candidates: [], userFeatures: user, now: NOW })).toEqual([]);
    const out = popularRankerV0.rank({ candidates: [cand('x', { source: 'fresh' })], userFeatures: null, now: NOW });
    expect(out.map((r) => [r.postId, r.source])).toEqual([['x', 'fresh']]);
  });
});

describe('registry', () => {
  it('đủ builder và ranker v0', () => {
    expect([...BUILDERS.keys()].sort()).toEqual(['hot@v0', 'none@v0', 'tag_affinity@v0']);
    expect([...RANKERS.keys()].sort()).toEqual(['popular_v0', 'tag_affinity_v0']);
  });

  it.each([
    [{ postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' }, true],
    [{ postBuilder: 'hot@v0', userBuilder: 'none@v0', ranker: 'popular_v0' }, true],
    [{ postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'popular_v0' }, true],
    [{ postBuilder: 'hot@v0', userBuilder: 'none@v0', ranker: 'tag_affinity_v0' }, false],
    [{ postBuilder: 'tag_affinity@v0', userBuilder: 'none@v0', ranker: 'popular_v0' }, false],
    [{ postBuilder: 'hot@v9', userBuilder: 'none@v0', ranker: 'popular_v0' }, false],
    [{ postBuilder: 'hot@v0', userBuilder: 'none@v0', ranker: 'random' }, false],
  ])('kiểm bộ ba %o → %s', (triple, ok) => {
    expect(resolveAlgo({ name: 'x', ...triple }).ok).toBe(ok);
  });
});

describe('candidates', () => {
  it('gộp nguồn, bỏ trùng, giữ source của nguồn đầu', () => {
    const merged = mergeCandidates([cand('a'), cand('b')], [cand('b', { source: 'fresh' }), cand('c', { source: 'fresh' })]);
    expect(merged.map((c) => `${c.postId}:${c.source}`)).toEqual(['a:hot', 'b:hot', 'c:fresh']);
  });

  it('explore tất định theo người + ngày, skip lấy phần tiếp theo', () => {
    const pool = Array.from({ length: 30 }, (_, i) => cand(`p${i}`));
    const a = pickExplore(pool, { userKey: 'u1', day: '2026-11-12' }, 3);
    expect(pickExplore(pool, { userKey: 'u1', day: '2026-11-12' }, 3)).toEqual(a);
    expect(a.every((x) => x.source === 'explore')).toBe(true);
    const next = pickExplore(pool, { userKey: 'u1', day: '2026-11-12' }, 3, 3);
    expect(next.some((x) => a.some((y) => y.postId === x.postId))).toBe(false);
    expect(pickExplore(pool, { userKey: 'u2', day: '2026-11-12' }, 3)).not.toEqual(a);
  });

  it('chèn explore vào giữa trang, giữ đúng limit', () => {
    const ranked = pickExplore(Array.from({ length: 30 }, (_, i) => cand(`r${i}`)), { userKey: 'k', day: 'd' }, 30).map((r) => ({ ...r, source: 'hot' as const }));
    const [e] = pickExplore([cand('e')], { userKey: 'k', day: 'd' }, 1);
    const page = interleave(ranked, [e!], 20);
    expect(page).toHaveLength(20);
    expect(page[10]!.postId).toBe('e');
    expect(interleave([], [e!], 20)).toEqual([e]);
  });
});
