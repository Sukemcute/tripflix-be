import type { Candidate } from '../domain/contracts.js';
import type { AlgoRow } from '../domain/registry.js';
import type { CandidateQuery, RecommendCatalog, RecommendStore, ServedStore } from './ports.js';
import { InvalidRecommendCursorError, PostRecommendationUseCases } from './post-recommendations.use-cases.js';

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
  const fresh = [cand('f1', { score: 0, source: 'fresh' })];
  const explore = Array.from({ length: 10 }, (_, i) => cand(`e0${i}`, { score: 0, source: 'explore' }));
  const without = (xs: Candidate[], q: CandidateQuery) => xs.filter((c) => !q.excludePostIds.includes(c.postId)).slice(0, q.limit);

  const store = {
    listActiveAlgos: vi.fn(async () => opts.algos ?? ALGOS),
    listInteractedPostIds: vi.fn(async () => ['h00']),
    findUserFeatures: vi.fn(async (key: string) => (key === 'tag_affinity@v0' ? { tags: { dalat: 1 }, places: { 'da-lat': 1 } } : {})),
    listHotCandidates: vi.fn(async (q: CandidateQuery) => without(hot, q)),
    listFreshCandidates: vi.fn(async (q: CandidateQuery) => without(fresh, q)),
    listExplorePool: vi.fn(async (q: CandidateQuery) => without([...hot, ...fresh, ...explore], q)),
  };
  const servedIds: string[] = [];
  const servedList = vi.fn(async () => [...servedIds]);
  const servedAdd = vi.fn(async (_u: string, ids: string[]) => void servedIds.unshift(...ids));
  const served: ServedStore = { list: servedList, add: servedAdd, ...opts.served };
  const catalog = {
    getVisiblePosts: vi.fn(async (ids: string[]) =>
      ids.filter((id) => !opts.hidden?.includes(id)).map((id) => ({ id, postType: 'video', title: id, hashtags: [], coverMediaId: null, authorId: 'a', reactionTotal: 0 })),
    ),
  };
  const useCases = new PostRecommendationUseCases(store as unknown as RecommendStore, catalog as unknown as RecommendCatalog, served);
  return { useCases, store, servedList, servedAdd, servedIds, catalog };
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
  it('có user: for_you đưa bài hợp gu lên đầu, bỏ bài đã tương tác, chèn ~5% explore, ghi đã phục vụ', async () => {
    const { useCases, servedAdd, store } = setup();
    const page = await useCases.recommend(query());
    expect(page.algo).toBe('for_you');
    expect(ids(page)[0]).toBe('d1');
    expect(page.items[0]!.reason.code).toBe('matches_place');
    expect(ids(page)).not.toContain('h00');
    expect(page.items).toHaveLength(10);
    expect(page.items.filter((i) => i.source === 'explore')).toHaveLength(1);
    expect(page.items.find((i) => i.source === 'explore')!.post.id).toMatch(/^e0/);
    expect(servedAdd).toHaveBeenCalledWith(U, ids(page));
    expect(store.listHotCandidates).toHaveBeenCalledWith(expect.objectContaining({ postBuilder: 'hot@v0', limit: 150, excludePostIds: ['h00'] }));
    expect(store.listFreshCandidates).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, hours: 48 }));
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

  it('Redis lỗi: vẫn trả kết quả, chỉ mất chống lặp', async () => {
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const { useCases } = setup({ served: { list: down, add: down } });
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

  it('lọc hết ứng viên: trả rỗng, không trả lại bài đã phục vụ', async () => {
    const { useCases, servedIds } = setup();
    const all = ['d1', 'f1', ...Array.from({ length: 30 }, (_, i) => `h${String(i).padStart(2, '0')}`), ...Array.from({ length: 10 }, (_, i) => `e0${i}`)];
    servedIds.push(...all);
    const page = await useCases.recommend(query());
    expect(page).toEqual({ items: [], algo: 'for_you', nextCursor: null });
  });

  it('bài đã ẩn sau lần job gần nhất thì bỏ khỏi trang', async () => {
    const { useCases } = setup({ hidden: ['d1'] });
    expect(ids(await useCases.recommend(query()))).not.toContain('d1');
  });

  it('cursor không do server cấp → lỗi', async () => {
    await expect(setup().useCases.recommend(query({ cursor: 'rác' }))).rejects.toBeInstanceOf(InvalidRecommendCursorError);
  });
});
