import type { Redis } from 'ioredis';
import { buildIndex } from '../domain/explore/build.js';
import { FAR_KM } from '../domain/explore/rank.js';
import type { ExploreStore } from '../application/ports.js';
import { ExploreStatsCache } from './explore-stats.cache.js';
import { indexedDocToTypesenseDoc, toTypesenseDocWithHash } from './typesense-mapper.js';
import { EXPLORE_SCHEMA_VERSION } from './typesense-schema.js';
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

  it('replaceAll chưa có alias: tạo collection mới (kèm phiên bản schema), nạp synonyms, bulk import, swap alias và xoá collection cũ', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const createCollection = vi.fn(async () => undefined);
    const upsertSynonym = vi.fn(async () => undefined);
    const importDocuments = vi.fn(async () => ({ success: 2, failed: 0 }));
    const upsertAlias = vi.fn(async () => undefined);
    const listCollections = vi.fn(async () => [{ name: 'explore_1', num_documents: 1 }, { name: 'other', num_documents: 1 }]);
    const deleteCollection = vi.fn(async () => undefined);
    const getAlias = vi.fn(async () => null);
    const client = { getAlias, createCollection, upsertSynonym, importDocuments, upsertAlias, listCollections, deleteCollection } as unknown as TypesenseClient;

    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    const ok = await store.replaceAll(index);
    expect(ok).toBe(true);
    expect(createCollection).toHaveBeenCalledTimes(1);
    expect(upsertSynonym).toHaveBeenCalled();
    const versioned = new RegExp(`^explore_${EXPLORE_SCHEMA_VERSION}_\\d+$`);
    expect(importDocuments).toHaveBeenCalledWith(expect.stringMatching(versioned), expect.any(Array), 'create');
    expect(upsertAlias).toHaveBeenCalledWith('explore', expect.stringMatching(versioned));
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

  it('candidatesBatch: gộp tất cả filter vào 1 multi_search và khử trùng theo id', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const tsDoc = indexedDocToTypesenseDoc(index.docs[1]!);

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
    expect(res[0]![0]!.id).toBe(index.docs[1]!.id);
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

  it('upsertDocuments & deleteDocuments gọi đúng endpoint Typesense', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const importDocuments = vi.fn(async () => ({ success: 1, failed: 0 }));
    const deleteDocumentsByIds = vi.fn(async () => 1);
    const health = vi.fn(async () => true);
    const client = { importDocuments, deleteDocumentsByIds, health } as unknown as TypesenseClient;

    const store = new TypesenseExploreStore(client, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    expect(await store.upsertDocuments([index.docs[1]!])).toBe(1);
    expect(importDocuments).toHaveBeenCalledWith('explore', expect.any(Array), 'upsert');
    expect(await store.deleteDocuments(['post:P1'])).toBe(1);
    expect(await store.healthCheck()).toBe(true);
  });

  it('hasIndex: true chỉ khi alias trỏ tới collection có tài liệu', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const make = (alias: { name: string; collection_name: string } | null, docs: number) =>
      new TypesenseExploreStore(
        {
          getAlias: vi.fn(async () => alias),
          listCollections: vi.fn(async () => [{ name: `explore_${EXPLORE_SCHEMA_VERSION}_2`, num_documents: docs }, { name: 'explore_2', num_documents: docs }]),
        } as unknown as TypesenseClient,
        statsCache,
        queryGramsStore,
        redis as unknown as Pick<Redis, 'set' | 'eval'>,
        'explore',
      );
    expect(await make(null, 10).hasIndex()).toBe(false);
    expect(await make({ name: 'explore', collection_name: `explore_${EXPLORE_SCHEMA_VERSION}_2` }, 0).hasIndex()).toBe(false);
    expect(await make({ name: 'explore', collection_name: `explore_${EXPLORE_SCHEMA_VERSION}_2` }, 10).hasIndex()).toBe(true);
    // Collection khác phiên bản schema (đổi schema xong khởi động lại): coi như chưa có để dựng ngay.
    expect(await make({ name: 'explore', collection_name: 'explore_2' }, 10).hasIndex()).toBe(false);
  });

  it('replaceAll cùng phiên bản schema: chỉ ghi mục đổi/mới, xoá mục không còn, không tạo collection', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const current = `explore_${EXPLORE_SCHEMA_VERSION}_1`;
    const [hotel, post] = index.docs;
    const client = {
      getAlias: vi.fn(async () => ({ name: 'explore', collection_name: current })),
      // Khách sạn không đổi (cùng hash, dù ord khác), bài đổi, còn một bài cũ đã bị gỡ khỏi nguồn.
      exportDocuments: vi.fn(async () => [
        { id: hotel!.id, content_hash: toTypesenseDocWithHash({ ...hotel!, ord: 99 }).content_hash },
        { id: post!.id, content_hash: 'hash-cu' },
        { id: 'post:GONE', content_hash: 'x' },
      ]),
      upsertSynonym: vi.fn(async () => undefined),
      importDocuments: vi.fn(async () => ({ success: 1, failed: 0 })),
      deleteDocumentsByIds: vi.fn(async () => 1),
      createCollection: vi.fn(),
      upsertAlias: vi.fn(),
    };
    const store = new TypesenseExploreStore(client as unknown as TypesenseClient, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    expect(await store.replaceAll(index)).toBe(true);
    expect(client.importDocuments).toHaveBeenCalledWith(current, [expect.objectContaining({ id: post!.id })], 'upsert');
    expect(client.deleteDocumentsByIds).toHaveBeenCalledWith(current, ['post:GONE']);
    expect(client.createCollection).not.toHaveBeenCalled();
    expect(client.upsertAlias).not.toHaveBeenCalled();
  });

  it('replaceAll alias trỏ collection khác phiên bản schema: dựng mới và đổi alias', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const client = {
      getAlias: vi.fn(async () => ({ name: 'explore', collection_name: 'explore_1795540833445' })),
      exportDocuments: vi.fn(),
      createCollection: vi.fn(async () => undefined),
      upsertSynonym: vi.fn(async () => undefined),
      importDocuments: vi.fn(async () => ({ success: 2, failed: 0 })),
      upsertAlias: vi.fn(async () => undefined),
      listCollections: vi.fn(async () => [{ name: 'explore_1795540833445', num_documents: 2 }]),
      deleteCollection: vi.fn(async () => undefined),
    };
    const store = new TypesenseExploreStore(client as unknown as TypesenseClient, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    expect(await store.replaceAll(index)).toBe(true);
    expect(client.exportDocuments).not.toHaveBeenCalled();
    expect(client.createCollection).toHaveBeenCalledTimes(1);
    expect(client.deleteCollection).toHaveBeenCalledWith('explore_1795540833445');
  });

  it('candidatesBatch: search con lỗi (vd sai cú pháp filter) thì ném lỗi, không trả kết quả thiếu', async () => {
    const redis = mockRedis('OK');
    const statsCache = new ExploreStatsCache(redis as unknown as Pick<Redis, 'get' | 'set'>);
    const multiSearch = vi.fn(async () => [{ code: 400, error: 'Could not parse the filter query.' }]);
    const store = new TypesenseExploreStore({ multiSearch } as unknown as TypesenseClient, statsCache, queryGramsStore, redis as unknown as Pick<Redis, 'set' | 'eval'>, 'explore');
    await expect(
      store.candidatesBatch([{ vertical: 'plans', isAll: true, terms: [], names: [], tiers: [], days: null, place: null, places: [], placeTerms: [], center: null, latSpan: FAR_KM / 111 }]),
    ).rejects.toThrow('Could not parse the filter query.');
  });
});
