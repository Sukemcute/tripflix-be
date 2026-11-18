import { createHash } from 'node:crypto';
import { hotV0 } from '../domain/builders/hot.js';
import { postProfileV1 } from '../domain/builders/post-profile.js';
import { CAPTION_MODEL, EXP, EXP_DESCRIPTIONS } from '../domain/topics.js';
import { BuildFeaturesUseCases } from './build-features.use-cases.js';
import type { RecommendCatalog, RecommendStore, TextEmbedder } from './ports.js';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('BuildFeaturesUseCases', () => {
  const setup = (embedder?: TextEmbedder) => {
    const store = {
      findTextVectors: vi.fn().mockResolvedValue(new Map()),
      insertTextVectors: vi.fn().mockResolvedValue(undefined),
      withLock: (_name: string, fn: () => Promise<unknown>) => fn(),
      replacePosts: vi.fn().mockResolvedValue(true),
      listActiveAlgos: vi.fn().mockResolvedValue([
        { name: 'for_you', postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' },
        { name: 'broken', postBuilder: 'hot@v9', userBuilder: 'none@v0', ranker: 'popular_v0' },
      ]),
      countPostInteractions: vi.fn().mockResolvedValue(new Map()),
      listPostInteractionSamples: vi.fn().mockResolvedValue(new Map()),
      replacePostScores: vi.fn().mockResolvedValue(undefined),
      listActiveUserIds: vi.fn().mockResolvedValue(['u1']),
      listUserRows: vi.fn().mockResolvedValue([]),
      upsertUserFeatures: vi.fn().mockResolvedValue(undefined),
      setJobState: vi.fn().mockResolvedValue(undefined),
    };
    const catalog: RecommendCatalog = {
      listPosts: () =>
        Promise.resolve({
          items: [
            {
              id: 'p1',
              authorId: 'a',
              postType: 'video',
              title: 't',
              body: '',
              hashtags: [],
              isVerified: false,
              mediaIds: [],
              coverMediaId: null,
              tripAttachment: null,
              createdAt: NOW,
            },
          ],
          nextCursor: null,
        }),
      listHotelProvinces: () => Promise.resolve({ items: [], nextCursor: null }),
      getVisiblePosts: () => Promise.resolve([]),
    };
    return { store, useCases: new BuildFeaturesUseCases(store as unknown as RecommendStore, catalog, embedder) };
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

  it('khi algo dùng hot@v1: đọc interactionSamples và ghi điểm hot@v1', async () => {
    const { store, useCases } = setup();
    store.listActiveAlgos.mockResolvedValue([{ name: 'trending', postBuilder: 'hot@v1', userBuilder: 'none@v0', ranker: 'popular_v0' }]);
    const listPostInteractionSamples = vi.fn().mockResolvedValue(
      new Map([['p1', [{ kind: 'order_item', actorAgeDays: 10, count: 1 }, { kind: 'reaction', actorAgeDays: 1, count: 1 }]]]),
    );
    store.listPostInteractionSamples = listPostInteractionSamples;

    const res = await useCases.runCycle(NOW);
    expect(res).toEqual({ posts: 1, users: 1, failedBuilders: [] });
    expect(listPostInteractionSamples).toHaveBeenCalledWith(NOW);
    expect(store.replacePostScores).toHaveBeenCalledWith('hot@v1', [
      expect.objectContaining({
        postId: 'p1',
        postType: 'video',
        score: 1,
        features: expect.objectContaining({ orders: 1, reactions: 1, signal: 10.2 }),
      }),
    ]);
  });

  describe('vector caption', () => {
    const sha = (t: string) => createHash('sha256').update(t).digest('hex');
    // Mô tả ngăn = trục riêng; caption 't' của bài p1 nằm đúng trục ngăn biển.
    const vectorOf = (text: string) => {
      const exp = text === 't' ? 'bien' : EXP.find((e) => EXP_DESCRIPTIONS[e] === text);
      return EXP.map((e) => (e === exp ? 1 : 0));
    };
    const embedderOf = (model = CAPTION_MODEL) => ({ embed: vi.fn(async (texts: string[]) => ({ model, vectors: texts.map(vectorOf) })) });
    type Store = ReturnType<typeof setup>['store'];
    const withProfileV1 = (store: Store) =>
      store.listActiveAlgos.mockResolvedValue([{ name: 'for_you', postBuilder: 'post_profile@v1', userBuilder: 'trip_profile@v1', ranker: 'trip_v1' }]);
    const binsOfP1 = (store: Store) =>
      (store.replacePostScores.mock.calls.find((c) => c[0] === postProfileV1.key)![1] as Array<{ features: { bins: Record<string, number> } }>)[0]!
        .features.bins;
    const allTexts = [...EXP.map((e) => EXP_DESCRIPTIONS[e]), 't'];

    it('cache thiếu thì gọi ai-service, ghi cache, builder thấy ngăn từ caption', async () => {
      const embedder = embedderOf();
      const { store, useCases } = setup(embedder);
      withProfileV1(store);
      await useCases.runCycle(NOW);
      expect(embedder.embed).toHaveBeenCalledWith(allTexts);
      expect(store.insertTextVectors).toHaveBeenCalledWith(CAPTION_MODEL, expect.arrayContaining([{ textHash: sha('t'), vector: vectorOf('t') }]));
      expect(binsOfP1(store)).toMatchObject({ 'exp:bien': 0.5 });
    });

    it('cache có đủ thì không gọi ai-service', async () => {
      const embedder = embedderOf();
      const { store, useCases } = setup(embedder);
      withProfileV1(store);
      store.findTextVectors.mockResolvedValue(new Map(allTexts.map((t) => [sha(t), vectorOf(t)])));
      await useCases.runCycle(NOW);
      expect(store.findTextVectors).toHaveBeenCalledWith(CAPTION_MODEL, allTexts.map(sha));
      expect(embedder.embed).not.toHaveBeenCalled();
      expect(binsOfP1(store)).toMatchObject({ 'exp:bien': 0.5 });
    });

    it('mô hình khác hoặc AI lỗi: không ghi cache, bỏ nguồn caption, job vẫn xong', async () => {
      const embedders = [embedderOf('other@1'), { embed: vi.fn().mockResolvedValue(null) }, { embed: vi.fn().mockRejectedValue(new Error('down')) }];
      for (const embedder of embedders) {
        const { store, useCases } = setup(embedder);
        withProfileV1(store);
        expect(await useCases.runCycle(NOW)).toMatchObject({ failedBuilders: [] });
        expect(store.insertTextVectors).not.toHaveBeenCalled();
        expect(binsOfP1(store)).not.toHaveProperty('exp:bien');
      }
    });

    it('không có embedder (AI chưa cấu hình): không đọc cache', async () => {
      const { store, useCases } = setup();
      await useCases.runCycle(NOW);
      expect(store.findTextVectors).not.toHaveBeenCalled();
    });
  });
});
