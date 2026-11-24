import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { ExploreStore } from '../application/ports.js';
import type { BuiltIndex, CandidateFilter, CountRow, IndexedDoc } from '../domain/explore/types.js';
import type { QueryGramRow } from '../domain/explore/vocab-gaps.js';
import { ExploreStatsCache } from './explore-stats.cache.js';
import { toTypesenseDocWithHash, typesenseDocToIndexedDoc, type TypesenseExploreDoc } from './typesense-mapper.js';
import { buildTypesenseSearches } from './typesense-query.builder.js';
import { buildExploreCollectionSchema, buildExploreSynonyms, EXPLORE_SCHEMA_VERSION } from './typesense-schema.js';
import { TypesenseClient, TypesenseError, type TypesenseSearchRequest } from './typesense.client.js';

const REBUILD_LOCK_KEY = 'discovery:explore:rebuild-lock';
const REBUILD_LOCK_MS = 120_000;
const SYNONYM_BATCH = 20;
const UNLOCK_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Chỉ mục tìm khám phá trên Typesense 29.0 (Phase 1–4):
 * - Tìm kiếm: 1 HTTP `multi_search` cho toàn bộ nhánh + cách hiểu.
 * - Bộ đếm (`df`, `ngram`, `street`, `brand`, `clat/clon`): đọc trên RAM từ `ExploreStatsCache` (0 SQL).
 * - Dựng chỉ mục: Atomic Alias Swap (`explore` -> `explore_<ts>`), 0ms downtime.
 * - Đếm câu tìm (`search_query_grams`): giữ ở Postgres thông qua `queryGramsStore`.
 */
export class TypesenseExploreStore implements ExploreStore {
  private readonly logger = new Logger(TypesenseExploreStore.name);

  constructor(
    private readonly client: TypesenseClient,
    private readonly statsCache: ExploreStatsCache,
    private readonly queryGramsStore: Pick<ExploreStore, 'recordQueryGrams' | 'listQueryGrams' | 'purgeQueryGrams'>,
    private readonly redis: Pick<Redis, 'set' | 'eval'>,
    private readonly alias = 'explore',
  ) {}

  counts(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<CountRow[]> {
    return this.statsCache.counts(keys);
  }

  typoPool(first: string, minLen: number, maxLen: number): Promise<Array<{ term: string; df: number }>> {
    return this.statsCache.typoPool(first, minLen, maxLen);
  }

  phrasePool(first: string, minLen: number, maxLen: number): Promise<string[]> {
    return this.statsCache.phrasePool(first, minLen, maxLen);
  }

  async candidates(filter: CandidateFilter): Promise<IndexedDoc[]> {
    const batch = await this.candidatesBatch([filter]);
    return batch[0] ?? [];
  }

  async candidatesBatch(filters: readonly CandidateFilter[]): Promise<IndexedDoc[][]> {
    if (!filters.length) return [];

    const slices: Array<{ start: number; count: number }> = [];
    const allSearches: TypesenseSearchRequest[] = [];
    for (const f of filters) {
      const built = buildTypesenseSearches(f);
      slices.push({ start: allSearches.length, count: built.length });
      allSearches.push(...built);
    }

    if (!allSearches.length) return filters.map(() => []);

    let results;
    try {
      results = await this.client.multiSearch<TypesenseExploreDoc>(allSearches, { collection: this.alias });
    } catch (err) {
      if (err instanceof TypesenseError && err.status === 404) {
        this.logger.warn(`Alias/collection Typesense "${this.alias}" chưa tồn tại, trả danh sách rỗng`);
        return filters.map(() => []);
      }
      throw err;
    }

    let loggedNotReady = false;
    return slices.map(({ start, count }) => {
      const byId = new Map<string, IndexedDoc>();
      for (let i = start; i < start + count; i++) {
        const res = results[i];
        if (!res) continue;
        if (res.code === 404) {
          if (!loggedNotReady) {
            this.logger.warn(`Alias/collection Typesense "${this.alias}" chưa sẵn sàng, trả danh sách rỗng`);
            loggedNotReady = true;
          }
          continue;
        }
        // Lỗi search con (cú pháp, timeout) mà bỏ qua thì kết quả thiếu nhưng trông như bình thường: ném ra.
        if (res.error) throw new TypesenseError(res.code ?? 500, `Typesense multi_search search con lỗi: ${res.error}`);
        for (const hit of res.hits ?? []) {
          if (hit.document && !byId.has(hit.document.id)) {
            byId.set(hit.document.id, typesenseDocToIndexedDoc(hit.document));
          }
        }
      }
      return [...byId.values()].sort((a, b) => a.ord - b.ord);
    });
  }

  /**
   * Đối soát chỉ mục với dữ liệu nguồn. Alias đang trỏ collection cùng phiên bản schema: chỉ ghi mục mới/đổi
   * (theo `content_hash`) và xoá mục không còn — lượng ghi tỉ lệ với số mục đổi, không phải cả chỉ mục.
   * Chưa có chỉ mục hoặc đổi schema: dựng collection mới rồi đổi alias (0 ms gián đoạn).
   */
  async replaceAll(index: BuiltIndex): Promise<boolean> {
    const token = randomUUID();
    const acquired = await this.redis.set(REBUILD_LOCK_KEY, token, 'PX', REBUILD_LOCK_MS, 'NX');
    if (!acquired) return false;
    try {
      const current = (await this.client.getAlias(this.alias))?.collection_name;
      if (current?.startsWith(`${this.alias}_${EXPLORE_SCHEMA_VERSION}_`)) await this.reconcile(current, index);
      else await this.rebuild(index);
      await this.statsCache.save(index.counts);
      return true;
    } finally {
      await this.redis.eval(UNLOCK_LUA, 1, REBUILD_LOCK_KEY, token).catch((err) => {
        this.logger.warn(`Nhả khoá Redis "${REBUILD_LOCK_KEY}" lỗi: ${(err as Error).message}`);
      });
    }
  }

  private async reconcile(collection: string, index: BuiltIndex): Promise<void> {
    const indexed = new Map(
      (await this.client.exportDocuments<{ id: string; content_hash?: string }>(collection, 'id,content_hash')).map((d) => [d.id, d.content_hash]),
    );
    const changed: Record<string, unknown>[] = [];
    for (const d of index.docs) {
      const doc = toTypesenseDocWithHash(d);
      if (indexed.get(d.id) !== doc.content_hash) changed.push(doc as unknown as Record<string, unknown>);
      indexed.delete(d.id);
    }
    const removed = [...indexed.keys()];
    await this.upsertSynonyms(collection);
    if (changed.length) await this.client.importDocuments(collection, changed, 'upsert');
    if (removed.length) await this.client.deleteDocumentsByIds(collection, removed);
    this.logger.log(`Đối soát chỉ mục ${collection}: ghi ${changed.length}, xoá ${removed.length}, giữ nguyên ${index.docs.length - changed.length}`);
  }

  private async rebuild(index: BuiltIndex): Promise<void> {
    const nextCollection = `${this.alias}_${EXPLORE_SCHEMA_VERSION}_${Date.now()}`;
    let swapped = false;
    try {
      await this.client.createCollection(buildExploreCollectionSchema(nextCollection));
      await this.upsertSynonyms(nextCollection);
      const docs = index.docs.map((d) => toTypesenseDocWithHash(d) as unknown as Record<string, unknown>);
      await this.client.importDocuments(nextCollection, docs, 'create');
      await this.client.upsertAlias(this.alias, nextCollection);
      swapped = true;
      await this.cleanupOldCollections(nextCollection);
    } catch (err) {
      if (!swapped) await this.client.deleteCollection(nextCollection).catch(() => undefined);
      throw err;
    }
  }

  private async upsertSynonyms(collection: string): Promise<void> {
    const synonyms = buildExploreSynonyms();
    for (let i = 0; i < synonyms.length; i += SYNONYM_BATCH) {
      await Promise.all(synonyms.slice(i, i + SYNONYM_BATCH).map((s) => this.client.upsertSynonym(collection, s.id, s.payload)));
    }
  }

  async upsertDocuments(docs: readonly IndexedDoc[]): Promise<number> {
    if (!docs.length) return 0;
    const payload = docs.map((d) => toTypesenseDocWithHash(d) as unknown as Record<string, unknown>);
    try {
      const res = await this.client.importDocuments(this.alias, payload, 'upsert');
      return res.success;
    } catch (err) {
      if (err instanceof TypesenseError && err.status === 404) {
        this.logger.warn(`Alias "${this.alias}" chưa tồn tại khi upsert ${docs.length} tài liệu`);
        return 0;
      }
      throw err;
    }
  }

  deleteDocuments(ids: string[]): Promise<number> {
    return this.client.deleteDocumentsByIds(this.alias, ids);
  }

  async hasIndex(): Promise<boolean> {
    const alias = await this.client.getAlias(this.alias);
    if (!alias) return false;
    const collections = await this.client.listCollections();
    return collections.some((c) => c.name === alias.collection_name && c.num_documents > 0);
  }

  healthCheck(): Promise<boolean> {
    return this.client.health(2_000);
  }

  recordQueryGrams(day: string, rows: QueryGramRow[]): Promise<void> {
    return this.queryGramsStore.recordQueryGrams(day, rows);
  }

  listQueryGrams(since: string, minCount: number): Promise<QueryGramRow[]> {
    return this.queryGramsStore.listQueryGrams(since, minCount);
  }

  purgeQueryGrams(before: string): Promise<number> {
    return this.queryGramsStore.purgeQueryGrams(before);
  }

  private async cleanupOldCollections(keepCollection: string): Promise<void> {
    try {
      const prefix = `${this.alias}_`;
      const collections = await this.client.listCollections();
      const stale = collections.filter((c) => c.name.startsWith(prefix) && c.name !== keepCollection);
      await Promise.all(stale.map((c) => this.client.deleteCollection(c.name)));
    } catch (err) {
      this.logger.warn(`Dọn collection Typesense cũ lỗi: ${(err as Error).message}`);
    }
  }
}
