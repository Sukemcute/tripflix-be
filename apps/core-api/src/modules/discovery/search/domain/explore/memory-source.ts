// ExploreSource trong RAM: cho test và so kết quả với bản Python. Điều kiện lọc ứng viên giống hệt câu SQL ở infra.
import { PHRASE_NS } from './stats.js';
import type { BuiltIndex, CandidateFilter, CountRow, ExploreSource, IndexedDoc } from './types.js';

/** Tài liệu có thể được bước chấm điểm chấp nhận không (tập cha). SQL ở drizzle-explore.store.ts phải giữ đúng điều kiện này. */
export function isCandidate(doc: IndexedDoc, f: CandidateFilter): boolean {
  if (doc.vertical !== f.vertical) return false;
  const o = doc.obj;
  if (f.place && o.place !== f.place) {
    if (!f.center || o.lat == null || Math.abs(o.lat - f.center.lat) > f.latSpan) return false;
  }
  if (f.isAll) return true;
  return (
    f.terms.some((t) => Object.hasOwn(doc.tf, t)) ||
    f.names.some((n) => doc.streets.includes(n)) ||
    (doc.tier !== null && f.tiers.includes(doc.tier[0])) ||
    (f.days !== null && o.days === f.days)
  );
}

export class MemoryExploreSource implements ExploreSource {
  private readonly values = new Map<string, number>();

  constructor(private readonly index: BuiltIndex) {
    for (const r of index.counts) this.values.set(`${r.ns}\u0000${r.key}`, r.n);
  }

  async counts(keys: ReadonlyArray<{ ns: string; key: string }>): Promise<CountRow[]> {
    return keys.flatMap((k) => {
      const n = this.values.get(`${k.ns}\u0000${k.key}`);
      return n === undefined ? [] : [{ ...k, n }];
    });
  }

  async typoPool(first: string, minLen: number, maxLen: number) {
    return this.index.counts
      .filter((r) => r.ns === 'df' && r.key.startsWith(first) && !r.key.includes('_') && r.key[0] !== '#')
      .filter((r) => r.key.length >= minLen && r.key.length <= maxLen)
      .map((r) => ({ term: r.key, df: r.n }));
  }

  async phrasePool(first: string, minLen: number, maxLen: number) {
    const keys = this.index.counts
      .filter((r) => PHRASE_NS.includes(r.ns) && r.key.startsWith(first) && r.key.includes(' '))
      .map((r) => r.key)
      .filter((k) => k.split(' ').join('').length >= minLen && k.split(' ').join('').length <= maxLen);
    return [...new Set(keys)];
  }

  async candidates(filter: CandidateFilter): Promise<IndexedDoc[]> {
    return this.index.docs.filter((d) => isCandidate(d, filter));
  }
}
