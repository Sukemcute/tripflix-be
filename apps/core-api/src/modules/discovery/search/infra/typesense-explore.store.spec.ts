import type { Redis } from 'ioredis';
import { buildIndex } from '../domain/explore/build.js';
import { FAR_KM } from '../domain/explore/rank.js';
import type { ExploreStore } from '../application/ports.js';
import { ExploreStatsCache } from './explore-stats.cache.js';
import { indexedDocToTypesenseDoc } from './typesense-mapper.js';
import { TypesenseExploreStore } from './typesense-explore.store.js';
import { TypesenseError, type TypesenseClient } from './typesense.client.js';

function mockRedis(lockResult: 'OK' | null = 'OK') {
  const kv = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => kv.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX')) return lockResult;
      kv.set(k, v);
      return 'OK';
    }),
    eval: vi.fn(async () => 1),
  };
}

describe('TypesenseExploreStore', () => {
  const index = buildIndex([
    { id: 'hotel:H1', refId: 'H1', kind: 'stay', title: 'Resort Đà Lạt', place: 'Đà Lạt', priceNight: 1_500_000, stars: 4 },
    { id: 'post:P1', refId: 'P1', kind: 'post', title: 'Review Đà Lạt', place: 'Đà Lạt', likes: 5, n: 1, createdAt: '2026-11-01T00:00:00Z' },
  ]);

  const queryGramsStore = {
    recordQueryGrams: vi.fn(async () => undefined),
    listQueryGrams: vi.fn(async () => []),
    purgeQueryGrams: vi.fn(async () => 0),
  } as unknown as Pick<ExploreStore, 'recordQueryGrams' | 'listQueryGrams' | 'purgeQueryGrams'>;

  it('replaceAll: tạo collection mới, nạp synonyms, bulk import, swap alias và xoá collection cũ', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const createCollection = vi.fn(async () => undefined);
    const upsertSynonym = vi.fn(async () => undefined);
    const importDocuments = vi.fn(async () => ({ success: 2, failed: 0 }));
    const upsertAlias = vi.fn(async () => undefined);
    const listCollections = vi.fn(async () => [{ name: 'explore_1', num_documents: 1 }, { name: 'other', num_documents: 1 }]);
    const deleteCollection = vi.fn(async () => undefined);
    const client = { createCollection, upsertSynonym, importDocuments, upsertAlias, listCollections, deleteCollection } as unknown as TypesenseClient;

    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    const ok = await store.replaceAll(index, new Map([['P1', 0.88]]));
    expect(ok).toBe(true);
    expect(createCollection).toHaveBeenCalledTimes(1);
    expect(upsertSynonym).toHaveBeenCalled();
    expect(importDocuments).toHaveBeenCalledWith(expect.stringMatching(/^explore_\d+$/), expect.any(Array), 'create');
    expect(upsertAlias).toHaveBeenCalledWith('explore', expect.stringMatching(/^explore_\d+$/));
    expect(deleteCollection).toHaveBeenCalledWith('explore_1');
    expect(deleteCollection).not.toHaveBeenCalledWith('other');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('replaceAll: bỏ lượt (trả false) khi worker khác đang giữ khoá Redis', async () => {
    const redis = mockRedis(null);
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const createCollection = vi.fn();
    const client = { createCollection } as unknown as TypesenseClient;
    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    expect(await store.replaceAll(index)).toBe(false);
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('candidatesBatch: gộp tất cả filter vào 1 multi_search, overlay likes/comments và khử trùng theo ord', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const tsDoc = indexedDocToTypesenseDoc(index.docs[1]!, 0.5);
    tsDoc.likes = 99;
    tsDoc.comments = 12;

    const multiSearch = vi.fn(async (searches: unknown[]) =>
      searches.map(() => ({ found: 1, hits: [{ document: tsDoc }, { document: tsDoc }] })),
    );
    const client = { multiSearch } as unknown as TypesenseClient;

    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    const res = await store.candidatesBatch([
      { vertical: 'plans', isAll: true, terms: [], names: [], tiers: [], days: null, place: null, places: [], placeTerms: [], center: null, latSpan: FAR_KM / 111 },
      { vertical: 'stays', isAll: true, terms: [], names: [], tiers: [], days: null, place: null, places: [], placeTerms: [], center: null, latSpan: FAR_KM / 111 },
    ]);
    expect(multiSearch).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(2);
    expect(res[0]).toHaveLength(1);
    expect(res[0]![0]!.obj.likes).toBe(99);
    expect(res[0]![0]!.obj.n).toBe(12);
  });

  it('candidatesBatch: xử lý 404 nhẹ nhàng khi chưa dựng chỉ mục lần đầu', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const client = {
      multiSearch: vi.fn(async () => {
        throw new TypesenseError(404, 'Not found');
      }),
    } as unknown as TypesenseClient;
    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    const res = await store.candidatesBatch([
      { vertical: 'plans', isAll: true, terms: [], names: [], tiers: [], days: null, place: null, places: [], placeTerms: [], center: null, latSpan: FAR_KM / 111 },
    ]);
    expect(res).toEqual([[]]);
  });

  it('upsertDocuments & updateMetrics & deleteDocuments gọi đúng endpoint Typesense', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const importDocuments = vi.fn(async () => ({ success: 1, failed: 0 }));
    const deleteDocumentsByIds = vi.fn(async () => 1);
    const health = vi.fn(async () => true);
    const client = { importDocuments, deleteDocumentsByIds, health } as unknown as TypesenseClient;

    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    expect(await store.upsertDocuments([index.docs[1]!], new Map([['P1', 0.7]]))).toBe(1);
    expect(importDocuments).toHaveBeenCalledWith('explore', expect.any(Array), 'upsert');
    expect(await store.updateMetrics([{ id: 'post:P1', likes: 15, hotScore: 0.9 }])).toBe(1);
    expect(importDocuments).toHaveBeenCalledWith('explore', [{ id: 'post:P1', likes: 15, hot_score: 0.9 }], 'update');
    expect(await store.deleteDocuments(['post:P1'])).toBe(1);
    expect(await store.healthCheck()).toBe(true);
  });
});
