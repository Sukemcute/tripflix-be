import type { Candidate, RawRow } from '../domain/contracts.js';
import type { AlgoRow } from '../domain/registry.js';
import type { CandidateQuery, RecentPostsStore, RecommendCatalog, RecommendStore, ServedStore } from './ports.js';
import { InvalidRecommendCursorError, PostRecommendationUseCases, ReelsFeedNotWiredError } from './post-recommendations.use-cases.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const U = 'u1';

const cand = (postId: string, over: Partial<Candidate> = {}): Candidate => ({
  postId,
  authorId: `a-${postId}`,
  postType: 'video',
  tags: [],
  placeId: null,
  score: 0.5,
  postFeatures: {},
  source: 'hot',
  ...over,
});

const ALGOS: AlgoRow[] = [
  { name: 'for_you', postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' },
  { name: 'trending', postBuilder: 'hot@v0', userBuilder: 'none@v0', ranker: 'popular_v0' },
];

/** 30 bài hot (h00 điểm cao nhất), bài Đà Lạt d1 điểm thấp, bài mới f1, pool explore e00..e09. */
function setup(opts: { algos?: AlgoRow[]; served?: Partial<ServedStore>; hidden?: string[]; viewerRows?: RawRow[] } = {}) {
  const hot = Array.from({ length: 30 }, (_, i) => cand(`h${String(i).padStart(2, '0')}`, { score: 1 - i / 100 }));
  hot.push(cand('d1', { score: 0.1, tags: ['dalat'], placeId: 'da-lat' }));
  hot.push(cand('b1', { score: 0.05, tags: ['beach', 'bien', 'nhatrang'], placeId: 'nha-trang', postFeatures: { bins: { 'place:nha-trang': 1 } } }));
  const fresh = [cand('f1', { score: 0, source: 'fresh' })];
  const explore = Array.from({ length: 10 }, (_, i) => cand(`e0${i}`, { score: 0, source: 'explore' }));
  const without = (xs: Candidate[], q: CandidateQuery) =>
    xs.filter((c) => !q.excludePostIds.includes(c.postId) && (!q.hasPlan || c.hasPlan)).slice(0, q.limit);

  const store = {
    listActiveAlgos: vi.fn(async () => opts.algos ?? ALGOS),
    listInteractedPostIds: vi.fn(async (_u: string, _until: Date) => ['h00']),
    listOwnRecentPostIds: vi.fn(async (_q: { userId: string; since: Date; until: Date; postType: string | null }): Promise<string[]> => []),
    findUserFeatures: vi.fn(async (key: string) => (key === 'tag_affinity@v0' ? { tags: { dalat: 1 }, places: { 'da-lat': 1 } } : {})),
    listHotCandidates: vi.fn(async (q: CandidateQuery) => without(hot, q)),
    listFreshCandidates: vi.fn(async (q: CandidateQuery) => without(fresh, q)),
    listExplorePool: vi.fn(async (q: CandidateQuery) => without([...hot, ...fresh, ...explore], q)),
    listUserRows: vi.fn(async (_ids: string[], _now: Date) => opts.viewerRows ?? []),
    findProductPlaces: vi.fn(async (_ids: string[]): Promise<Record<string, string>> => ({})),
    listPlaceStyleCounts: vi.fn(async () => [{ placeId: 'nha-trang', style: 'biển', hotels: 10 }, { placeId: 'ha-noi', style: 'thành phố', hotels: 10 }]),
    findPostMetas: vi.fn(async (postIds: string[]) =>
      postIds.map((postId) => ({ postId, authorId: 'a', postType: 'video', tags: ['Beach', 'bien', 'nhatrang'], placeId: 'nha-trang', hasPlan: false })),
    ),
  };
  /** Bài vừa tương tác: id → lúc (ms), như ZSET 2 giờ trong Redis. */
  const recentAt = new Map<string, number>();
  const recent: RecentPostsStore = {
    list: vi.fn(async (_u: string, until: Date) =>
      [...recentAt].filter(([, t]) => t <= until.getTime() && t > until.getTime() - 2 * 3600_000).map(([postId, at]) => ({ postId, at })),
    ),
    record: vi.fn(async () => undefined),
  };
  /** id → lúc gợi ý (ms), như ZSET trong Redis. */
  const seenAt = new Map<string, number>();
  const servedList = vi.fn(async (_u: string, before: Date) => [...seenAt].filter(([, t]) => t < before.getTime()).map(([id]) => id));
  const servedAdd = vi.fn(async (_u: string, ids: string[], at: Date) => ids.forEach((id) => seenAt.set(id, at.getTime())));
  const served: ServedStore = { listBefore: servedList, add: servedAdd, ...opts.served };
  const catalog = {
    getVisiblePosts: vi.fn(async (ids: string[]) =>
      ids.filter((id) => !opts.hidden?.includes(id)).map((id) => ({ id, postType: 'video', title: id, hashtags: [], coverMediaId: null, authorId: 'a', reactionTotal: 0 })),
    ),
  };
  const useCases = new PostRecommendationUseCases(store as unknown as RecommendStore, catalog as unknown as RecommendCatalog, served, recent);
  return { useCases, store, servedList, servedAdd, seenAt, catalog, recentAt };
}

const query = (over: Partial<Parameters<PostRecommendationUseCases['recommend']>[0]> = {}) => ({
  mode: 'for_you' as const,
  postType: null,
  limit: 10,
  cursor: null,
  userId: U,
  now: NOW,
  ...over,
});
const ids = (page: { items: Array<{ post: { id: string } }> }) => page.items.map((i) => i.post.id);

describe('PostRecommendationUseCases', () => {
  it('ranker v1 (trip_v1): đọc toàn bộ bài, đưa dòng thô người xem vào ranker; vừa tìm Nha Trang thì bài Nha Trang lên đầu', async () => {
    const search = (i: number): RawRow => ({
      actorType: 'user', actorId: U, kind: 'search', refId: `s${i}`, targetType: 'place', targetId: 'nha-trang',
      value: null, isRemoved: false, detail: null, occurredAt: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(),
    });
    const { useCases, store } = setup({
      algos: [{ name: 'for_you', postBuilder: 'post_profile@v1', userBuilder: 'trip_profile@v1', ranker: 'trip_v1' }, ALGOS[1]!],
      viewerRows: [search(0), search(1)],
    });
    const page = await useCases.recommend(query());
    expect(store.listHotCandidates).toHaveBeenCalledWith(expect.objectContaining({ postBuilder: 'post_profile@v1', limit: 5000 }));
    expect(store.listUserRows).toHaveBeenCalledWith([U], expect.any(Date));
    expect(page.items[0]).toMatchObject({ post: { id: 'b1' }, reason: { code: 'matches_place', text: 'Vì bạn đang tìm hiểu Nha Trang' } });
    // Mọi bài là ứng viên: ô khám phá vẫn có bài (lấy ngoài top), không rỗng.
    expect(page.items.some((i) => i.source === 'explore')).toBe(true);
  });

  it('trip_v1: cuộn hết các trang không gặp lại bài nào, kể cả khi gọi trang sau vài phút sau (điểm "vừa xảy ra" đổi theo phút)', async () => {
    const search = (minsAgo: number, placeId: string): RawRow => ({
      actorType: 'user', actorId: U, kind: 'search', refId: `s${minsAgo}`, targetType: 'place', targetId: placeId,
      value: null, isRemoved: false, detail: null, occurredAt: new Date(NOW.getTime() - minsAgo * 60_000).toISOString(),
    });
    const { useCases } = setup({
      algos: [{ name: 'for_you', postBuilder: 'post_profile@v1', userBuilder: 'trip_profile@v1', ranker: 'trip_v1' }, ALGOS[1]!],
      viewerRows: [search(5, 'nha-trang'), search(120, 'da-lat'), search(130, 'da-lat')],
    });
    const all: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await useCases.recommend(query({ limit: 5, cursor, now: new Date(NOW.getTime() + page * 7 * 60_000) }));
      all.push(...ids(res));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size).toBe(all.length);
  });

  it('ranker cũ không đọc dòng thô người xem và giữ giới hạn 150 bài hot', async () => {
    const { useCases, store } = setup();
    await useCases.recommend(query());
    expect(store.listUserRows).not.toHaveBeenCalled();
    expect(store.listHotCandidates).toHaveBeenCalledWith(expect.objectContaining({ limit: 150 }));
  });

  it('có user: for_you đưa bài hợp gu lên đầu, đẩy bài đã tương tác xuống, chèn ~5% explore, ghi đã phục vụ', async () => {
    const { useCases, servedAdd, store } = setup();
    const page = await useCases.recommend(query());
    expect(page.algo).toBe('for_you');
    expect(ids(page)[0]).toBe('d1');
    expect(page.items[0]!.reason.code).toBe('matches_place');
    expect(ids(page)).not.toContain('h00');
    expect(page.items).toHaveLength(10);
    expect(page.items.filter((i) => i.source === 'explore')).toHaveLength(1);
    expect(page.items.find((i) => i.source === 'explore')!.post.id).toMatch(/^e0/);
    expect(servedAdd).toHaveBeenCalledWith(U, ids(page), NOW);
    expect(store.listHotCandidates).toHaveBeenCalledWith(expect.objectContaining({ postBuilder: 'hot@v0', limit: 150, excludePostIds: [] }));
    expect(store.listFreshCandidates).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, hours: 48, excludePostIds: [] }));
    expect(store.listExplorePool).toHaveBeenCalledWith(expect.objectContaining({ excludePostIds: ['h00'] }));
  });

  it('bài đã thả tim không biến mất: kho ít bài thì vẫn hiện, nằm cuối danh sách', async () => {
    const { useCases, store } = setup();
    store.listInteractedPostIds.mockResolvedValue(['h00', 'h01']);
    store.listHotCandidates.mockImplementation(async (q: CandidateQuery) =>
      ['h00', 'h01', 'h02', 'h03'].filter((id) => !q.excludePostIds.includes(id)).map((id, i) => cand(id, { score: 1 - i / 10 })),
    );
    store.listFreshCandidates.mockResolvedValue([]);
    store.listExplorePool.mockResolvedValue([]);
    const page = await useCases.recommend(query({ mode: 'trending' }));
    expect(ids(page)).toEqual(['h02', 'h03', 'h00', 'h01']);
  });

  it('thả tim giữa phiên: trang sau không xô lệch, tương tác chốt theo lúc tải trang đầu', async () => {
    const { useCases, store } = setup();
    const reactedAt = NOW.getTime() + 30_000;
    store.listInteractedPostIds.mockImplementation(async (_u: string, until: Date) => (until.getTime() >= reactedAt ? ['h00', 'h15'] : ['h00']));
    const first = await useCases.recommend(query({ mode: 'trending' }));
    const expected = ids(await useCases.recommend(query({ mode: 'trending', cursor: first.nextCursor })));
    expect(expected).toContain('h15');
    const later = new Date(NOW.getTime() + 60_000);
    expect(ids(await useCases.recommend(query({ mode: 'trending', cursor: first.nextCursor, now: later })))).toEqual(expected);
    expect(store.listInteractedPostIds).toHaveBeenLastCalledWith(U, NOW);
  });

  it('2 trang liên tiếp không trùng bài; trang sau giữ thuật toán của trang đầu', async () => {
    const { useCases, store } = setup();
    const first = await useCases.recommend(query());
    store.listActiveAlgos.mockResolvedValue([{ ...ALGOS[0]!, ranker: 'popular_v0' }, ALGOS[1]!]);
    const second = await useCases.recommend(query({ cursor: first.nextCursor, mode: 'trending' }));
    expect(second.algo).toBe('for_you');
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
  });

  it('khách: nhận trending, không đụng Redis, phân trang bằng offset không trùng', async () => {
    const { useCases, servedList, servedAdd, store } = setup();
    const first = await useCases.recommend(query({ userId: null }));
    expect(first.algo).toBe('trending');
    expect(ids(first)[0]).toBe('h00');
    expect(servedList).not.toHaveBeenCalled();
    expect(servedAdd).not.toHaveBeenCalled();
    expect(store.listInteractedPostIds).not.toHaveBeenCalled();
    const second = await useCases.recommend(query({ userId: null, cursor: first.nextCursor }));
    expect(second.items).toHaveLength(10);
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
  });

  it('kho explore rỗng: trang vẫn đủ limit bằng bài xếp hạng và còn trang sau', async () => {
    const { useCases, store } = setup();
    store.listExplorePool.mockResolvedValue([]);
    const first = await useCases.recommend(query());
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const second = await useCases.recommend(query({ cursor: first.nextCursor }));
    expect(second.items).toHaveLength(10);
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
  });

  it('Redis lỗi: vẫn trả kết quả, chỉ mất chống lặp', async () => {
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const { useCases } = setup({ served: { listBefore: down, add: down } });
    const page = await useCases.recommend(query());
    expect(page.items).toHaveLength(10);
    expect(page.algo).toBe('for_you');
  });

  it('bộ ba sai: từ chối, dùng trending; trending cũng sai thì dùng bộ ba dự phòng', async () => {
    const bad = { ...ALGOS[0]!, userBuilder: 'none@v0' };
    expect((await setup({ algos: [bad, ALGOS[1]!] }).useCases.recommend(query())).algo).toBe('trending');
    expect((await setup({ algos: [] }).useCases.recommend(query())).algo).toBe('trending');
  });

  it('cache recommend_algos 60 giây', async () => {
    const { useCases, store } = setup();
    await useCases.recommend(query());
    await useCases.recommend(query());
    expect(store.listActiveAlgos).toHaveBeenCalledTimes(1);
  });

  it('tải lại cùng trang (sau khi thả tim): ra đúng các bài cũ, không rỗng', async () => {
    const { useCases } = setup();
    const first = await useCases.recommend(query());
    const second = await useCases.recommend(query({ cursor: first.nextCursor }));
    const later = new Date(NOW.getTime() + 60_000);
    expect(ids(await useCases.recommend(query({ now: later })))).toEqual(ids(first));
    expect(ids(await useCases.recommend(query({ cursor: first.nextCursor, now: later })))).toEqual(ids(second));
  });

  it('bài đã xem ở phiên trước: phạt điểm chứ không bỏ; xem hết thì vẫn còn bài', async () => {
    const { useCases, seenAt } = setup();
    const all = ['d1', 'f1', ...Array.from({ length: 30 }, (_, i) => `h${String(i).padStart(2, '0')}`), ...Array.from({ length: 10 }, (_, i) => `e0${i}`)];
    const yesterday = NOW.getTime() - 24 * 3600_000;
    all.filter((id) => id !== 'h05').forEach((id) => seenAt.set(id, yesterday));
    const page = await useCases.recommend(query());
    expect(ids(page)[0]).toBe('h05');
    expect(page.items).toHaveLength(10);
  });

  it('bài vừa tự đăng (chưa qua job) lên đầu feed của chính người đăng, không lặp ở trang sau', async () => {
    const { useCases, store } = setup();
    store.listOwnRecentPostIds.mockResolvedValue(['mine']);
    const first = await useCases.recommend(query({ postType: 'video' }));
    expect(ids(first)[0]).toBe('mine');
    expect(first.items[0]).toMatchObject({ source: 'own', reason: { code: 'own_post' } });
    expect(store.listOwnRecentPostIds).toHaveBeenCalledWith({ userId: U, since: new Date(NOW.getTime() - 3600_000), until: NOW, postType: 'video' });
    const second = await useCases.recommend(query({ postType: 'video', cursor: first.nextCursor }));
    expect(ids(second)).not.toContain('mine');
  });

  it('bài tự đăng đã là ứng viên (job đã chạy): vẫn lên đầu, không trùng', async () => {
    const { useCases, store } = setup();
    store.listOwnRecentPostIds.mockResolvedValue(['h00']);
    const page = await useCases.recommend(query({ mode: 'trending' }));
    expect(ids(page)[0]).toBe('h00');
    expect(ids(page).filter((id) => id === 'h00')).toHaveLength(1);
  });

  it('khách không đọc bài tự đăng', async () => {
    const { useCases, store } = setup();
    await useCases.recommend(query({ userId: null }));
    expect(store.listOwnRecentPostIds).not.toHaveBeenCalled();
  });

  it('bài đã ẩn sau lần job gần nhất thì bỏ khỏi trang', async () => {
    const { useCases } = setup({ hidden: ['d1'] });
    expect(ids(await useCases.recommend(query()))).not.toContain('d1');
  });

  it('gu trong phiên: vừa thích bài biển thì lần tải feed sau bài biển lên ngay, không chờ job', async () => {
    const { useCases, recentAt } = setup();
    expect(ids(await useCases.recommend(query()))).not.toContain('b1');
    recentAt.set('liked-beach', NOW.getTime() - 60_000);
    const page = await useCases.recommend(query());
    expect(ids(page).slice(0, 2)).toEqual(['d1', 'b1']);
    expect(page.items[1]!.reason.code).not.toBe('trending');
  });

  it('gu trong phiên giảm dần: thích từ 90 phút trước thì gần như hết tác dụng', async () => {
    const { useCases, recentAt } = setup();
    recentAt.set('liked-beach', NOW.getTime() - 90 * 60_000);
    expect(ids(await useCases.recommend(query()))).not.toContain('b1');
  });

  it('gu trong phiên chốt theo trang đầu: thích giữa chừng không làm trang sau xô lệch', async () => {
    const { useCases, recentAt } = setup();
    const first = await useCases.recommend(query());
    const expected = ids(await setup().useCases.recommend(query({ cursor: first.nextCursor })));
    recentAt.set('liked-beach', NOW.getTime() + 30_000);
    const second = await useCases.recommend(query({ cursor: first.nextCursor, now: new Date(NOW.getTime() + 60_000) }));
    expect(ids(second)).toEqual(expected);
  });

  it('trending không đọc gu trong phiên', async () => {
    const { useCases, recentAt, store } = setup();
    recentAt.set('liked-beach', NOW.getTime() - 60_000);
    await useCases.recommend(query({ mode: 'trending' }));
    expect(store.findPostMetas).not.toHaveBeenCalled();
  });

  it('cursor không do server cấp → lỗi', async () => {
    await expect(setup().useCases.recommend(query({ cursor: 'rác' }))).rejects.toBeInstanceOf(InvalidRecommendCursorError);
  });

  it('recommendReels: gọi getReelCardsByIds đúng thứ tự, bỏ bài không phát được và chỉ ghi served cho bài trả về', async () => {
    const servedAdd = vi.fn(async () => undefined);
    const { useCases, catalog } = setup({ served: { add: servedAdd } });
    const getReelCardsByIds = vi.fn(async (postIds: string[]) =>
      postIds
        .filter((id) => id !== 'h02')
        .reverse()
        .map((postId) => ({
          postId,
          author: { id: `a-${postId}`, name: null, avatarUrl: null, isKol: false },
          video: { url: `https://cdn/${postId}.m3u8` },
          title: postId,
          caption: '',
          region: null,
          tags: [],
          linkedProductIds: [],
          tripAttachment: null,
          counts: { likes: 0, comments: 0, saves: 0, shares: 0 },
          viewerState: null,
          reason: null,
        })),
    );
    (catalog as unknown as RecommendCatalog).getReelCardsByIds = getReelCardsByIds;

    const page = await useCases.recommendReels({ mode: 'trending', limit: 5, cursor: null, userId: U, now: NOW });
    expect(getReelCardsByIds).toHaveBeenCalledWith(expect.any(Array), U);
    const returnedIds = page.items.map((i) => i.card.postId);
    expect(returnedIds).toHaveLength(4);
    expect(returnedIds).not.toContain('h02');
    // Thứ tự phải khớp thứ tự xếp hạng ban đầu, không bị đảo theo kết quả mock .reverse()
    expect(returnedIds).toEqual((getReelCardsByIds.mock.calls[0]![0] as string[]).filter((id) => id !== 'h02'));
    expect(servedAdd).toHaveBeenCalledWith(U, returnedIds, NOW);
  });

  it('recommendReels khi chưa nối FeedFacade → ReelsFeedNotWiredError', async () => {
    await expect(setup().useCases.recommendReels({ mode: 'trending', limit: 5, cursor: null, userId: null, now: NOW })).rejects.toBeInstanceOf(
      ReelsFeedNotWiredError,
    );
  });

  describe('Reels Hot của feed (TF111)', () => {
    const card = (postId: string) => ({
      postId,
      author: { id: `a-${postId}`, name: null, avatarUrl: null, isKol: false },
      video: {},
      title: postId,
      caption: '',
      region: null,
      tags: [],
      linkedProductIds: [],
      tripAttachment: null,
      counts: { likes: 0, comments: 0, saves: 0, shares: 0 },
      viewerState: null,
      reason: null,
    });
    /** Danh sách Hot của feed: X00..X{n-1}, cursor của mỗi bài là `c:<id>`, trang sau bắt đầu ngay sau bài đó. */
    const wireFeed = (catalog: unknown, n: number, hidden: string[] = []) => {
      const hot = Array.from({ length: n }, (_, i) => `X${String(i).padStart(2, '0')}`);
      const c = catalog as RecommendCatalog;
      c.getReelCardsByIds = vi.fn(async (postIds: string[]) => postIds.filter((id) => !hidden.includes(id)).map(card));
      c.listTopHotReels = vi.fn(async ({ limit, cursor }: { limit: number; cursor: string | null }) => {
        if (cursor !== null && !cursor.startsWith('c:')) throw new Error('cursor feed sai');
        const start = cursor === null ? 0 : hot.indexOf(cursor.slice(2)) + 1;
        const items = hot.slice(start, start + limit).map((postId) => ({ postId, cursor: `c:${postId}` }));
        return { items, nextCursor: start + limit < n ? `c:${hot[start + limit - 1]}` : null };
      });
      return c;
    };
    const reelIds = (page: { items: Array<{ card: { postId: string } }> }) => page.items.map((i) => i.card.postId);

    it('trending: đúng thứ tự Hot của feed, đi tiếp bằng cursor của feed, bỏ bài không phát được', async () => {
      const { useCases, catalog } = setup();
      wireFeed(catalog, 7, ['X01']);
      const p1 = await useCases.recommendReels({ mode: 'trending', limit: 4, cursor: null, userId: U, now: NOW });
      expect([p1.algo, reelIds(p1)]).toEqual(['feed_hot', ['X00', 'X02', 'X03']]);
      expect(p1.items.every((i) => i.source === 'hot' && i.reason.code === 'trending')).toBe(true);
      const p2 = await useCases.recommendReels({ mode: 'for_you', limit: 4, cursor: p1.nextCursor, userId: U, now: NOW });
      expect([reelIds(p2), p2.nextCursor]).toEqual([['X04', 'X05', 'X06'], null]);
    });

    it('mixed: ô 4, 8 là Hot của feed, còn lại Dành cho bạn; trang sau đi tiếp cả hai nguồn không lặp', async () => {
      const { useCases, catalog } = setup();
      wireFeed(catalog, 6);
      const p1 = await useCases.recommendReels({ mode: 'mixed', limit: 8, cursor: null, userId: U, now: NOW });
      expect(p1.algo).toBe('mixed');
      expect(p1.items.map((i) => (i.card.postId.startsWith('X') ? 'HOT' : 'FY'))).toEqual(['FY', 'FY', 'FY', 'HOT', 'FY', 'FY', 'FY', 'HOT']);
      const p2 = await useCases.recommendReels({ mode: 'trending', limit: 8, cursor: p1.nextCursor, userId: U, now: NOW });
      expect(reelIds(p2).filter((id) => id.startsWith('X'))).toEqual(['X02', 'X03']);
      expect(reelIds(p2).filter((id) => reelIds(p1).includes(id))).toEqual([]);
    });

    it('mixed: Hot hết thì Dành cho bạn lấp cả trang; khách vẫn dùng được', async () => {
      const { useCases, catalog } = setup();
      wireFeed(catalog, 1);
      const p1 = await useCases.recommendReels({ mode: 'mixed', limit: 4, cursor: null, userId: null, now: NOW });
      expect(reelIds(p1)).toContain('X00');
      const p2 = await useCases.recommendReels({ mode: 'mixed', limit: 4, cursor: p1.nextCursor, userId: null, now: NOW });
      expect(p2.items).toHaveLength(4);
      expect(p2.items.every((i) => i.source !== 'hot' || !i.card.postId.startsWith('X'))).toBe(true);
    });

    it('fresh: tải lại trong 30 phút không ra y hệt trang cũ; trang sau giữ cùng mốc đọc bài đã gợi ý', async () => {
      const { useCases, catalog, servedList } = setup();
      wireFeed(catalog, 6);
      const first = await useCases.recommendReels({ mode: 'for_you', limit: 4, cursor: null, userId: U, now: NOW });
      const later = new Date(NOW.getTime() + 60_000);
      // Không fresh: bài vừa gợi ý 1 phút trước chưa tính là phiên trước nên trang đầu y hệt.
      const again = await useCases.recommendReels({ mode: 'for_you', limit: 4, cursor: null, userId: U, now: later });
      expect(reelIds(again)).toEqual(reelIds(first));
      // Tải lại luôn tới sau lần gợi ý trước đó.
      const reloadAt = new Date(later.getTime() + 1_000);
      const fresh = await useCases.recommendReels({ mode: 'for_you', limit: 4, cursor: null, userId: U, now: reloadAt, fresh: true });
      expect(reelIds(fresh).filter((id) => reelIds(first).includes(id))).toEqual([]);
      expect(servedList.mock.calls.at(-1)![1]).toEqual(reloadAt);
      // Trang sau tới muộn hơn vẫn đọc bài đã gợi ý theo mốc của trang đầu, nên không xô lệch.
      await useCases.recommendReels({ mode: 'for_you', limit: 4, cursor: fresh.nextCursor, userId: U, now: new Date(reloadAt.getTime() + 5_000) });
      expect(servedList.mock.calls.at(-1)![1]).toEqual(reloadAt);
    });

    it('fresh với mixed: phần Dành cho bạn đổi, cursor mang mốc sang trang sau; fresh kèm cursor thì bỏ qua', async () => {
      const { useCases, catalog, servedList } = setup();
      wireFeed(catalog, 6);
      const forYouIds = (page: { items: Array<{ card: { postId: string } }> }) => reelIds(page).filter((id) => !id.startsWith('X'));
      const first = await useCases.recommendReels({ mode: 'mixed', limit: 8, cursor: null, userId: U, now: NOW });
      const later = new Date(NOW.getTime() + 60_000);
      const fresh = await useCases.recommendReels({ mode: 'mixed', limit: 8, cursor: null, userId: U, now: later, fresh: true });
      expect(forYouIds(fresh).filter((id) => forYouIds(first).includes(id))).toEqual([]);
      await useCases.recommendReels({ mode: 'mixed', limit: 8, cursor: fresh.nextCursor, userId: U, now: new Date(later.getTime() + 5_000), fresh: true });
      expect(servedList.mock.calls.at(-1)![1]).toEqual(later);
      // Cursor không fresh giữ nguyên dạng cũ, không có seenUntil.
      const plain = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()) as Record<string, unknown>;
      expect(plain).not.toHaveProperty('seenUntil');
    });

    it('cursor Hot bị sửa → InvalidRecommendCursorError; mixed khi chưa nối listTopHot → ReelsFeedNotWiredError', async () => {
      const { useCases, catalog } = setup();
      wireFeed(catalog, 5);
      const forged = Buffer.from(JSON.stringify({ algo: 'feed_hot', mode: 'trending', page: 1, offset: 0, seenBefore: 0, hot: 'rác' })).toString('base64url');
      await expect(useCases.recommendReels({ mode: 'trending', limit: 4, cursor: forged, userId: U, now: NOW })).rejects.toBeInstanceOf(
        InvalidRecommendCursorError,
      );
      const bare = setup();
      (bare.catalog as unknown as RecommendCatalog).getReelCardsByIds = vi.fn(async () => []);
      await expect(bare.useCases.recommendReels({ mode: 'mixed', limit: 4, cursor: null, userId: U, now: NOW })).rejects.toBeInstanceOf(
        ReelsFeedNotWiredError,
      );
    });
  });

  it('mode has_plan: chỉ trả bài có lịch trình (kể cả slot explore), khách dùng trending + lọc', async () => {
    const { useCases, store } = setup();
    // Gắn hasPlan cho một số bài hot, fresh và explore
    const hotPlan = Array.from({ length: 6 }, (_, i) => cand(`hp0${i}`, { score: 0.9 - i / 100, hasPlan: true }));
    const freshPlan = [cand('fp1', { score: 0, source: 'fresh', hasPlan: true })];
    const explorePlan = [cand('ep1', { score: 0, source: 'explore', hasPlan: true })];
    const exploreNoPlan = [cand('e_no_plan', { score: 0, source: 'explore', hasPlan: false })];
    store.listHotCandidates.mockImplementation(async (q: CandidateQuery) => (q.hasPlan ? hotPlan : []));
    store.listFreshCandidates.mockImplementation(async (q: CandidateQuery) => (q.hasPlan ? freshPlan : []));
    store.listExplorePool.mockImplementation(async (q: CandidateQuery) =>
      [...exploreNoPlan, ...explorePlan].filter((c) => !q.excludePostIds.includes(c.postId) && (!q.hasPlan || c.hasPlan)),
    );

    const userPage = await useCases.recommend(query({ mode: 'has_plan', limit: 5, userId: U }));
    expect(userPage.algo).toBe('for_you');
    expect(userPage.items).toHaveLength(5);
    expect(userPage.items.every((i) => i.post.id !== 'e_no_plan')).toBe(true);
    expect(store.listHotCandidates).toHaveBeenCalledWith(expect.objectContaining({ hasPlan: true }));
    expect(store.listFreshCandidates).toHaveBeenCalledWith(expect.objectContaining({ hasPlan: true }));
    expect(store.listExplorePool).toHaveBeenCalledWith(expect.objectContaining({ hasPlan: true }));

    // Khách gọi has_plan vẫn chạy: dùng trending + lọc hasPlan
    const guestPage = await useCases.recommend(query({ mode: 'has_plan', limit: 5, userId: null }));
    expect(guestPage.algo).toBe('trending');
    expect(guestPage.items).toHaveLength(5);

    // Trang sau qua cursor giữ nguyên mode has_plan dù request không truyền hoặc truyền khác
    const page2 = await useCases.recommend(query({ mode: 'has_plan', limit: 5, cursor: userPage.nextCursor, userId: U }));
    expect(page2.items.every((i) => !userPage.items.map((x) => x.post.id).includes(i.post.id))).toBe(true);
  });

  it('mode has_plan: bài tự đăng có lịch trình vẫn hiện, bài tự đăng không lịch trình bị lọc (findPostMetas trả hasPlan)', async () => {
    const { useCases, store } = setup();
    const hotPlan = Array.from({ length: 6 }, (_, i) => cand(`hp0${i}`, { score: 0.9 - i / 100, hasPlan: true }));
    store.listHotCandidates.mockImplementation(async (q: CandidateQuery) => (q.hasPlan ? hotPlan : []));
    store.listFreshCandidates.mockResolvedValue([]);
    store.listExplorePool.mockResolvedValue([]);
    store.listOwnRecentPostIds.mockResolvedValue(['own-plan', 'own-no-plan']);
    store.findPostMetas.mockImplementation(async (postIds: string[]) =>
      postIds.map((postId) => ({ postId, authorId: U, postType: 'video', tags: ['dalat'], placeId: 'da-lat', hasPlan: postId === 'own-plan' })),
    );

    const page = await useCases.recommend(query({ mode: 'has_plan', limit: 5, userId: U }));
    const ids = page.items.map((i) => i.post.id);
    expect(ids).toContain('own-plan');
    expect(ids).not.toContain('own-no-plan');
    expect(page.items.find((i) => i.post.id === 'own-plan')!.reason.code).toBe('own_post');
  });

  it('mode recent: đúng thứ tự mới nhất, không explore/ranker, phân trang không lặp không sót', async () => {
    const { useCases, store } = setup();
    const recentPool = Array.from({ length: 7 }, (_, i) => cand(`r0${i}`, { score: 0, source: 'explore' }));
    store.listExplorePool.mockResolvedValue(recentPool);
    store.listOwnRecentPostIds.mockResolvedValue(['own1']);

    const p1 = await useCases.recommend(query({ mode: 'recent', limit: 4, userId: U }));
    expect(p1.algo).toBe('recent');
    expect(p1.items.map((i) => i.post.id)).toEqual(['own1', 'r00', 'r01', 'r02']);
    expect(p1.items[0]!.reason.code).toBe('own_post');
    expect(p1.items[1]!.reason).toEqual({ code: 'recent', text: 'Mới đăng' });
    expect(p1.items[1]!.source).toBe('fresh');

    const p2 = await useCases.recommend(query({ mode: 'recent', limit: 4, cursor: p1.nextCursor, userId: U }));
    expect(p2.algo).toBe('recent');
    expect(p2.items.map((i) => i.post.id)).toEqual(['r03', 'r04', 'r05', 'r06']);
    expect(p2.nextCursor).toBeNull();

    // Gọi lại cùng cursor ra cùng trang
    const p2Again = await useCases.recommend(query({ mode: 'recent', limit: 4, cursor: p1.nextCursor, userId: U }));
    expect(p2Again.items.map((i) => i.post.id)).toEqual(['r03', 'r04', 'r05', 'r06']);
  });

  describe('trang bị lọc hết sau hydrate', () => {
    const pool = Array.from({ length: 30 }, (_, i) => cand(`r${String(i).padStart(2, '0')}`, { score: 0, source: 'explore' }));
    const recentQuery = (over: Partial<Parameters<PostRecommendationUseCases['recommend']>[0]> = {}) =>
      query({ mode: 'recent', limit: 3, ...over });

    it('trang đầu toàn bài ẩn: server lấy tiếp trang sau, không trả items rỗng kèm cursor', async () => {
      const { useCases, store } = setup({ hidden: ['r00', 'r01', 'r02'] });
      store.listExplorePool.mockResolvedValue(pool);
      const page = await useCases.recommend(recentQuery());
      expect(ids(page)).toEqual(['r03', 'r04', 'r05']);
      const next = await useCases.recommend(recentQuery({ cursor: page.nextCursor }));
      expect(ids(next)).toEqual(['r06', 'r07', 'r08']);
    });

    it('mọi trang đều bị lọc: dừng sau giới hạn, trả rỗng kèm cursor để client tự quyết', async () => {
      const { useCases, store, catalog } = setup({ hidden: pool.map((c) => c.postId) });
      store.listExplorePool.mockResolvedValue(pool);
      const page = await useCases.recommend(recentQuery());
      expect(page.items).toEqual([]);
      expect(page.nextCursor).not.toBeNull();
      expect(catalog.getVisiblePosts).toHaveBeenCalledTimes(4);
    });

    it('hết bài thì trả cursor null như cũ', async () => {
      const { useCases, store } = setup({ hidden: pool.map((c) => c.postId) });
      store.listExplorePool.mockResolvedValue(pool.slice(0, 5));
      const page = await useCases.recommend(recentQuery());
      expect(page).toMatchObject({ items: [], nextCursor: null });
    });

    it('recommendReels: trang đầu không có video phát được thì lấy trang sau', async () => {
      const { useCases, store, catalog } = setup();
      store.listExplorePool.mockResolvedValue(pool);
      (catalog as unknown as RecommendCatalog).getReelCardsByIds = vi.fn(async (postIds: string[]) =>
        postIds.filter((id) => id >= 'r03').map((postId) => ({ postId }) as never),
      );
      const page = await useCases.recommendReels({ mode: 'recent', limit: 3, cursor: null, userId: U, now: NOW });
      expect(page.items.map((i) => i.card.postId)).toEqual(['r03', 'r04', 'r05']);
    });
  });
});
