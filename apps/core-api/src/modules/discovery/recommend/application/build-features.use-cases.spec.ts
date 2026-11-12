import { hotV0 } from '../domain/builders/hot.js';
import { BuildFeaturesUseCases } from './build-features.use-cases.js';
import type { RecommendCatalog, RecommendStore } from './ports.js';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('BuildFeaturesUseCases', () => {
  const setup = () => {
    const store = {
      withLock: (_name: string, fn: () => Promise<unknown>) => fn(),
      replacePosts: vi.fn().mockResolvedValue(true),
      listActiveAlgos: vi.fn().mockResolvedValue([
        { name: 'for_you', postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' },
        { name: 'broken', postBuilder: 'hot@v9', userBuilder: 'none@v0', ranker: 'popular_v0' },
      ]),
      countPostInteractions: vi.fn().mockResolvedValue(new Map()),
      replacePostScores: vi.fn().mockResolvedValue(undefined),
      listActiveUserIds: vi.fn().mockResolvedValue(['u1']),
      listUserRows: vi.fn().mockResolvedValue([]),
      upsertUserFeatures: vi.fn().mockResolvedValue(undefined),
      setJobState: vi.fn().mockResolvedValue(undefined),
    };
    const catalog: RecommendCatalog = {
      listPosts: () =>
        Promise.resolve({
          items: [{ id: 'p1', authorId: 'a', postType: 'video', title: 't', hashtags: [], isVerified: false, tripAttachment: null, createdAt: NOW }],
          nextCursor: null,
        }),
      listHotelProvinces: () => Promise.resolve({ items: [], nextCursor: null }),
    };
    return { store, useCases: new BuildFeaturesUseCases(store as unknown as RecommendStore, catalog) };
  };

  it('builder lỗi: không ghi đè dữ liệu của nó, ghi last_error, vẫn chạy builder khác', async () => {
    const { store, useCases } = setup();
    const spy = vi.spyOn(hotV0, 'build').mockRejectedValueOnce(new Error('hỏng'));
    try {
      expect(await useCases.runCycle(NOW)).toEqual({ posts: 1, users: 1, failedBuilders: ['hot@v0'] });
    } finally {
      spy.mockRestore();
    }
    expect(store.replacePostScores).not.toHaveBeenCalled();
    expect(store.setJobState).toHaveBeenCalledWith('hot@v0', { lastRunAt: NOW, lastError: 'hỏng' });
    expect(store.upsertUserFeatures).toHaveBeenCalledWith('tag_affinity@v0', [expect.objectContaining({ userId: 'u1' })]);
    expect(store.setJobState).toHaveBeenCalledWith('build-features', expect.objectContaining({ lastError: 'Builder lỗi: hot@v0' }));
  });

  it('dòng recommend_algos có bộ ba sai thì bỏ qua builder của nó', async () => {
    const { store, useCases } = setup();
    await useCases.runCycle(NOW);
    expect(store.upsertUserFeatures.mock.calls.map((c) => c[0])).toEqual(['tag_affinity@v0']);
  });

  it('output sai featuresSchema: coi như builder lỗi', async () => {
    const { store, useCases } = setup();
    const spy = vi.spyOn(hotV0, 'build').mockResolvedValueOnce([{ postId: 'p1', score: 1, features: { reactions: 'nhiều' } }]);
    try {
      expect((await useCases.runCycle(NOW))?.failedBuilders).toEqual(['hot@v0']);
    } finally {
      spy.mockRestore();
    }
    expect(store.replacePostScores).not.toHaveBeenCalled();
  });
});
