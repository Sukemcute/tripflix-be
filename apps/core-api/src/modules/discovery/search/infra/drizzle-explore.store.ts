import type { Db } from '@tripflix/db';
import { and, arrayOverlaps, asc, between, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { searchCounts, searchDocuments, searchQueryGrams } from '../../db/schema/index.js';
import type { ExploreStore } from '../application/ports.js';
import { candidateLimitOf } from '../domain/explore/memory-source.js';
import { PHRASE_NS } from '../domain/explore/stats.js';
import type { BuiltIndex, CandidateFilter, CountRow, IndexedDoc } from '../domain/explore/types.js';
import { MAX_SAMPLES, type QueryGramRow } from '../domain/explore/vocab-gaps.js';

const CHUNK = 1000;
/** Khoá advisory của job dựng chỉ mục: hai worker cùng chạy thì một bên bỏ lượt. */
const INDEX_LOCK = 'discovery.explore-index';
// ponytail: chấm G² trên chừng này n-gram nhiều lượt nhất; đủ cho pilot, lớn hơn thì lọc thêm trong SQL.
const MAX_QUERY_GRAMS = 2_000;

export class DrizzleExploreStore implements ExploreStore {
  constructor(private readonly db: Db) {}

  async counts(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<CountRow[]> {
    if (!keys.length) return [];
    const byNs = new Map<string, string[]>();
    for (const k of keys) byNs.set(k.ns, [...(byNs.get(k.ns) ?? []), k.key]);
    return this.db
      .select()
      .from(searchCounts)
      .where(or(...[...byNs].map(([ns, ks]) => and(eq(searchCounts.ns, ns), inArray(searchCounts.key, ks)))));
  }

  /** Đọc toàn bộ bộ đếm để khởi tạo fallback RAM cache lúc cold-start nếu Redis chưa có snapshot. */
  async loadAllCounts(): Promise<CountRow[]> {
    return this.db.select().from(searchCounts);
  }

  async typoPool(first: string, minLen: number, maxLen: number) {
    // Từ đơn của chỉ mục: không có '_' (cặp từ), không bắt đầu bằng '#' (viết tắt).
    const rows = await this.db
      .select({ term: searchCounts.key, df: searchCounts.n })
      .from(searchCounts)
      .where(
        and(
          eq(searchCounts.ns, 'df'),
          eq(sql`left(${searchCounts.key}, 1)`, first),
          eq(sql`strpos(${searchCounts.key}, '_')`, 0),
          between(sql`length(${searchCounts.key})`, minLen, maxLen),
        ),
      );
    return rows;
  }

  async phrasePool(first: string, minLen: number, maxLen: number) {
    const rows = await this.db
      .selectDistinct({ term: searchCounts.key })
      .from(searchCounts)
      .where(
        and(
          inArray(searchCounts.ns, [...PHRASE_NS]),
          eq(sql`left(${searchCounts.key}, 1)`, first),
          sql`strpos(${searchCounts.key}, ' ') > 0`,
          between(sql`length(replace(${searchCounts.key}, ' ', ''))`, minLen, maxLen),
        ),
      );
    return rows.map((r) => r.term);
  }

  /** Cùng điều kiện với isCandidate trong domain/explore/memory-source.ts. */
  async candidates(f: CandidateFilter): Promise<IndexedDoc[]> {
    const where: Array<SQL | undefined> = [eq(searchDocuments.vertical, f.vertical)];
    if (f.place) {
      where.push(
        or(
          inArray(searchDocuments.place, f.places.length ? f.places : [f.place]),
          !f.isAll ? isNull(searchDocuments.place) : undefined, // điều kiện khớp từ bên dưới vẫn áp dụng
          f.placeTerms.length ? and(isNull(searchDocuments.place), arrayOverlaps(searchDocuments.terms, f.placeTerms)) : undefined,
          f.center
            ? and(gte(searchDocuments.lat, f.center.lat - f.latSpan), lte(searchDocuments.lat, f.center.lat + f.latSpan))
            : undefined,
        ),
      );
    }
    if (!f.isAll) {
      where.push(
        or(
          f.terms.length ? arrayOverlaps(searchDocuments.terms, f.terms) : undefined,
          f.names.length ? arrayOverlaps(searchDocuments.streets, f.names) : undefined,
          f.tiers.length ? inArray(searchDocuments.tier, f.tiers) : undefined,
          f.days !== null ? eq(searchDocuments.days, f.days) : undefined,
          sql`false`,
        ),
      );
    }
    const rows = await this.db
      .select({ doc: searchDocuments.doc })
      .from(searchDocuments)
      .where(and(...where))
      .orderBy(asc(searchDocuments.ord))
      .limit(candidateLimitOf(f));
    return rows.map((r) => r.doc);
  }

  async replaceAll(index: BuiltIndex): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${INDEX_LOCK}, 0)) as ok`);
      if (!lock.rows[0]?.ok) return false;
      await tx.delete(searchDocuments);
      await tx.delete(searchCounts);
      const docs = index.docs.map((d) => ({
        id: d.id,
        vertical: d.vertical,
        ord: d.ord,
        place: d.obj.place ?? null,
        lat: d.obj.lat ?? null,
        lon: d.obj.lon ?? null,
        days: d.obj.days ?? null,
        tier: d.tier?.[0] ?? null,
        terms: Object.keys(d.tf),
        streets: d.streets,
        doc: d,
      }));
      for (let i = 0; i < docs.length; i += CHUNK) await tx.insert(searchDocuments).values(docs.slice(i, i + CHUNK));
      for (let i = 0; i < index.counts.length; i += CHUNK) await tx.insert(searchCounts).values(index.counts.slice(i, i + CHUNK));
      return true;
    });
  }

  async deleteDocuments(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const deleted = await this.db.delete(searchDocuments).where(inArray(searchDocuments.id, ids)).returning({ id: searchDocuments.id });
    return deleted.length;
  }

  async recordQueryGrams(day: string, rows: QueryGramRow[]): Promise<void> {
    if (!rows.length) return;
    const t = searchQueryGrams;
    // `search_query_grams.x` trong DO UPDATE là dòng đang có; `excluded.x` là dòng vừa gửi.
    await this.db
      .insert(t)
      .values(rows.map((r) => ({ day, gram: r.gram, hits: r.hits, samples: r.samples })))
      .onConflictDoUpdate({
        target: [t.day, t.gram],
        set: {
          hits: sql`search_query_grams.hits + excluded.hits`,
          samples: sql`case when cardinality(search_query_grams.samples) < ${MAX_SAMPLES}
            and not search_query_grams.samples @> excluded.samples
            then search_query_grams.samples || excluded.samples else search_query_grams.samples end`,
        },
      });
  }

  async listQueryGrams(since: string, minCount: number): Promise<QueryGramRow[]> {
    const t = searchQueryGrams;
    const result = await this.db.execute<{ gram: string; hits: number; samples: string[] }>(sql`
      select g.gram, sum(g.hits)::int as hits,
        array(
          select distinct s from ${t} g2, unnest(g2.samples) s
          where g2.gram = g.gram and g2.day >= ${since} limit ${MAX_SAMPLES}
        ) as samples
      from ${t} g
      where g.day >= ${since}
      group by g.gram
      having sum(g.hits) >= ${minCount} or g.gram like '#%'
      order by sum(g.hits) desc
      limit ${MAX_QUERY_GRAMS}`);
    return result.rows;
  }

  async purgeQueryGrams(before: string): Promise<number> {
    const deleted = await this.db.delete(searchQueryGrams).where(lt(searchQueryGrams.day, before)).returning({ day: searchQueryGrams.day });
    return deleted.length;
  }
}
