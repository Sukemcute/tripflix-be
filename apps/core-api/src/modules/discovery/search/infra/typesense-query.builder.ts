import { FAR_KM } from '../domain/explore/rank.js';
import type { CandidateFilter } from '../domain/explore/types.js';
import { escapeTypesenseFilterValue, type TypesenseSearchRequest } from './typesense.client.js';

const QUERY_BY = 'title_vi,title_folded,streets_vi,streets_folded,tags_folded,body_vi,body_folded,abbrs';
const QUERY_BY_WEIGHTS = '12,8,7,5,6,3,2,5';
const DEFAULT_LIMIT = 100;
const MAX_PER_PAGE = 250;
/** Lân cận khác nơi chỉ phục vụ "Gần …" (≤ 40 km) và kết quả thay thế: không cần nhiều. */
const NEAR_PER_PAGE = 50;
/** Rerank chỉ đọc IndexedDoc đã lưu; các trường tìm chữ (body, terms…) không cần trả về (~40% mỗi hit). */
const INCLUDE_FIELDS = 'id,doc_json';

function listFilter(field: string, values: readonly string[]): string {
  return `${field}:=[${values.map(escapeTypesenseFilterValue).join(',')}]`;
}

function exactOrClauses(f: CandidateFilter): string[] {
  const clauses: string[] = [];
  if (f.terms.length) clauses.push(listFilter('terms', f.terms));
  if (f.names.length) clauses.push(listFilter('streets_folded', f.names));
  if (f.tiers.length) clauses.push(listFilter('tier', f.tiers));
  if (f.days !== null) clauses.push(`days:=${f.days}`);
  return clauses;
}

/**
 * Một phạm vi nơi → tối đa 2 search: A khớp chữ (BM25, synonyms, typo), B khớp đúng token (`terms`, tên đường,
 * hạng, số ngày) cho các mở rộng concept/viết tắt mà khớp chữ có thể sót. `priority` đứng đầu `sort_by`
 * để mục thuộc phạm vi ưu tiên không bị đẩy khỏi top-K.
 */
function scopeSearches(
  f: CandidateFilter,
  scopeFilter: string,
  perPage: number,
  priority: string | null,
  orExpr: string | null,
): TypesenseSearchRequest[] {
  const lead = priority ? `${priority},` : '';
  if (f.isAll) {
    const near = f.user ? `location(${f.user.lat},${f.user.lon}):asc,` : '';
    return [{ q: '*', filter_by: scopeFilter, sort_by: `${lead}${near}quality_score:desc,ord:asc`, per_page: perPage, include_fields: INCLUDE_FIELDS }];
  }
  const out: TypesenseSearchRequest[] = [];
  const q = f.queryText?.trim() ?? '';
  if (q) {
    out.push({
      q,
      query_by: QUERY_BY,
      query_by_weights: QUERY_BY_WEIGHTS,
      text_match_type: 'max_weight',
      drop_tokens_threshold: 100,
      num_typos: 2,
      filter_by: scopeFilter,
      sort_by: `${lead}_text_match:desc,quality_score:desc`,
      per_page: perPage,
      include_fields: INCLUDE_FIELDS,
    });
  }
  if (orExpr) {
    out.push({
      q: '*',
      filter_by: `${scopeFilter} && (${orExpr})`,
      sort_by: `${lead}quality_score:desc,ord:asc`,
      per_page: perPage,
      include_fields: INCLUDE_FIELDS,
    });
  }
  return out;
}

/**
 * Dịch một CandidateFilter thành các search con trong cùng `multi_search` (câu có nơi: tối đa 3 phạm vi × 2):
 * 1. Đúng nơi, và (câu có từ) bài chưa rõ nơi cho kết quả thay thế, chung một search: `_eval` xếp mọi mục đúng nơi
 *    trước (đã thử trên Typesense 29), bài chưa rõ nơi chỉ lấp chỗ còn trống.
 * 2. Bài chưa rõ nơi có nhắc tên nơi: là kết quả chính nên có chỗ riêng, không chia với đúng nơi (Hà Nội có hàng trăm mục).
 * 3. Lân cận trong bán kính FAR_KM, trừ đúng nơi: `_eval` không chấm theo khoảng cách nên tách riêng.
 */
export function buildTypesenseSearches(f: CandidateFilter): TypesenseSearchRequest[] {
  const base = `vertical:=${escapeTypesenseFilterValue(f.vertical)}`;
  const perPage = Math.min(MAX_PER_PAGE, Math.max(10, f.limit ?? DEFAULT_LIMIT));
  const smallPage = Math.min(NEAR_PER_PAGE, perPage);
  const clauses = exactOrClauses(f);
  const orExpr = clauses.length ? clauses.join(' || ') : null;

  if (!f.place) return scopeSearches(f, base, perPage, null, orExpr);

  const places = listFilter('place', f.places.length ? f.places : [f.place]);
  const main = f.isAll ? `${base} && ${places}` : `${base} && (${places} || has_place:=false)`;
  const out = scopeSearches(f, main, perPage, f.isAll ? null : `_eval(${places}):desc`, orExpr);
  if (f.placeTerms.length) {
    out.push(...scopeSearches(f, `${base} && has_place:=false && ${listFilter('terms', f.placeTerms)}`, smallPage, null, orExpr));
  }
  if (f.center) {
    // Lọc bán kính cần dấu `:` (location:(…)); dạng sort location(…):asc thì không.
    const near = `${base} && location:(${f.center.lat}, ${f.center.lon}, ${FAR_KM} km) && ${places.replace(':=', ':!=')}`;
    out.push(...scopeSearches(f, near, smallPage, null, orExpr));
  }
  return out;
}
