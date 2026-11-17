import type { Candidate } from '../domain/contracts.js';
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
function setup(opts: { algos?: AlgoRow[]; served?: Partial<ServedStore>; hidden?: string[] } = {}) {
  const hot = Array.from({ length: 30 }, (_, i) => cand(`h${String(i).padStart(2, '0')}`, { score: 1 - i / 100 }));
  hot.push(cand('d1', { score: 0.1, tags: ['dalat'], placeId: 'da-lat' }));
  hot.push(cand('b1', { score: 0.05, tags: ['beach', 'bien', 'nhatrang'], placeId: 'nha-trang' }));
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
    findPostMetas: vi.fn(async (postIds: string[]) =>
      postIds.map((postId) => ({ postId, authorId: 'a', postType: 'video', tags: ['Beach', 'bien', 'nhatrang'], placeId: 'nha-trang' })),
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
});
