import type { Db } from '@tripflix/db';
import { and, arrayOverlaps, asc, between, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { searchCounts, searchDocuments } from '../../db/schema/index.js';
import type { ExploreStore } from '../application/ports.js';
import { PHRASE_NS } from '../domain/explore/stats.js';
import type { BuiltIndex, CandidateFilter, CountRow, IndexedDoc } from '../domain/explore/types.js';

const CHUNK = 1000;
/** Khoá advisory của job dựng chỉ mục: hai worker cùng chạy thì một bên bỏ lượt. */
const INDEX_LOCK = 'discovery.explore-index';

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
          eq(searchDocuments.place, f.place),
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
      .orderBy(asc(searchDocuments.ord));
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
}
