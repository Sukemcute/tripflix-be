// ExploreSource trong RAM: cho test và so kết quả với bản Python. Điều kiện lọc ứng viên giống hệt câu SQL ở infra.
import { PHRASE_NS } from './stats.js';
import type { BuiltIndex, CandidateFilter, CountRow, ExploreSource, IndexedDoc } from './types.js';

/**
 * Trần ứng viên mỗi nhánh: không bao giờ kéo cả bảng search_documents về Node (parse + chấm điểm là việc đồng bộ, chặn event loop).
 * Câu không có từ tìm lẫn nơi ('nhậu', 'ăn gì') chỉ cần EMPTY_QUERY_LIMIT; câu có từ hoặc nơi cần nhiều hơn để không sót bài đúng nơi.
 * ponytail: lấy theo ord (thứ tự dựng chỉ mục), không theo độ khớp/chất lượng; khớp > trần thì có thể sót bài tốt.
 * Nâng cấp: sắp ord theo quality lúc buildIndex, hoặc ORDER BY số từ khớp trong SQL.
 */
export const CANDIDATE_LIMIT = 500;
export const EMPTY_QUERY_LIMIT = 100;

export function candidateLimitOf(f: CandidateFilter): number {
  return f.isAll && !f.place ? EMPTY_QUERY_LIMIT : CANDIDATE_LIMIT;
}

/** Tài liệu có thể được bước chấm điểm chấp nhận không (tập cha). SQL ở drizzle-explore.store.ts phải giữ đúng điều kiện này. */
export function isCandidate(doc: IndexedDoc, f: CandidateFilter): boolean {
  if (doc.vertical !== f.vertical) return false;
  const o = doc.obj;
  // Chưa rõ nơi: là ứng viên khi nhắc tới nơi, hoặc khi câu có từ (làm kết quả thay thế lúc dữ liệu ít).
  const isUnknownOk = o.place == null && (!f.isAll || f.placeTerms.some((t) => Object.hasOwn(doc.tf, t)));
  if (f.place && !(o.place && f.places.includes(o.place)) && !isUnknownOk) {
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
    return this.index.docs.filter((d) => isCandidate(d, filter)).slice(0, candidateLimitOf(filter));
  }
}
