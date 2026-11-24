import { candidateLimitOf } from '../domain/explore/memory-source.js';
import { FAR_KM } from '../domain/explore/rank.js';
import type { CandidateFilter } from '../domain/explore/types.js';
import { escapeTypesenseFilterValue, type TypesenseSearchRequest } from './typesense.client.js';

const QUERY_BY = 'title_vi,title_folded,streets_vi,streets_folded,tags_folded,body_vi,body_folded,abbrs';
const QUERY_BY_WEIGHTS = '12,8,7,5,6,3,2,5';
/** Trần per_page của Typesense: lấy nhiều hơn thì xin thêm trang trong cùng multi_search. */
const MAX_PER_PAGE = 250;

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

/** Tách một search lấy `limit` mục thành các trang ≤ MAX_PER_PAGE. */
function paged(req: TypesenseSearchRequest, limit: number): TypesenseSearchRequest[] {
  if (limit <= MAX_PER_PAGE) return [{ ...req, per_page: limit }];
  return Array.from({ length: Math.ceil(limit / MAX_PER_PAGE) }, (_, i) => ({ ...req, per_page: MAX_PER_PAGE, page: i + 1 }));
}

function buildScopeSearches(
  f: CandidateFilter,
  scopeFilter: string,
  perPage: number,
  allSortBy: string,
  orExpr: string | null,
): TypesenseSearchRequest[] {
  if (f.isAll) {
    return paged({ q: '*', filter_by: scopeFilter, sort_by: allSortBy }, perPage);
  }
  const out: TypesenseSearchRequest[] = [];
  const q = f.queryText?.trim() ?? '';
  if (q) {
    out.push(
      ...paged({
      q,
      query_by: QUERY_BY,
      query_by_weights: QUERY_BY_WEIGHTS,
      text_match_type: 'max_weight',
      drop_tokens_threshold: 100,
      num_typos: 2,
      filter_by: scopeFilter,
      sort_by: '_text_match:desc,quality_score:desc,ord:asc',
    }, perPage));
  }
  if (orExpr) {
    out.push(...paged({ q: '*', filter_by: `${scopeFilter} && (${orExpr})`, sort_by: 'quality_score:desc,ord:asc' }, perPage));
  }
  return out;
}

/**
 * Dịch một CandidateFilter thành 1 hoặc nhiều request con trong cùng `multi_search`.
 * Tách nhóm nơi rõ ràng (đúng nơi / nhắc nơi / lân cận 150km / chưa rõ nơi) thành các search phẳng để:
 * 1) tránh ngoặc lồng nhau trong `filter_by`;
 * 2) không để mục lân cận hoặc chưa rõ nơi đẩy mục đúng nơi ra khỏi Top-K.
 */
export function buildTypesenseSearches(f: CandidateFilter): TypesenseSearchRequest[] {
  const base = `is_hidden:=false && vertical:=${escapeTypesenseFilterValue(f.vertical)}`;
  // Cùng trần với bản Postgres (500, câu rỗng 100) để hai backend chấm trên cùng cỡ tập ứng viên.
  const perPage = candidateLimitOf(f);
  const allSortBy = f.user ? `location(${f.user.lat},${f.user.lon}):asc,quality_score:desc,ord:asc` : 'quality_score:desc,ord:asc';
  const clauses = exactOrClauses(f);
  const orExpr = clauses.length ? clauses.join(' || ') : null;

  if (!f.place) {
    return buildScopeSearches(f, base, perPage, allSortBy, orExpr);
  }

  const out: TypesenseSearchRequest[] = [];
  const places = f.places.length ? f.places : [f.place];

  // 1. Đúng nơi / tỉnh thuộc phạm vi tìm.
  out.push(...buildScopeSearches(f, `${base} && ${listFilter('place', places)}`, perPage, allSortBy, orExpr));

  // 2. Bài chưa rõ nơi có nhắc tên nơi (isMention).
  if (f.placeTerms.length) {
    const mentionScope = `${base} && has_place:=false && ${listFilter('terms', f.placeTerms)}`;
    out.push(...buildScopeSearches(f, mentionScope, perPage, allSortBy, orExpr));
  }

  // 3. Bài chưa rõ nơi nhưng khớp từ tìm (cho tầng fallback khi !isAll).
  if (!f.isAll) {
    out.push(...buildScopeSearches(f, `${base} && has_place:=false`, perPage, allSortBy, orExpr));
  }

  // 4. Địa điểm lân cận trong bán kính FAR_KM (150 km).
  if (f.center) {
    const geoScope = `${base} && location(${f.center.lat}, ${f.center.lon}, ${FAR_KM} km)`;
    out.push(...buildScopeSearches(f, geoScope, perPage, allSortBy, orExpr));
  }

  return out;
}
