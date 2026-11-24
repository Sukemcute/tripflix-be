import { FAR_KM } from '../domain/explore/rank.js';
import type { CandidateFilter } from '../domain/explore/types.js';
import { escapeTypesenseFilterValue, type TypesenseSearchRequest } from './typesense.client.js';

const QUERY_BY = 'title_vi,title_folded,streets_vi,streets_folded,tags_folded,body_vi,body_folded,abbrs';
const QUERY_BY_WEIGHTS = '12,8,7,5,6,3,2,5';
const DEFAULT_LIMIT = 100;
const MAX_PER_PAGE = 250;
const FALLBACK_PER_PAGE = 80;

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

function buildScopeSearches(
  f: CandidateFilter,
  scopeFilter: string,
  perPage: number,
  allSortBy: string,
  orExpr: string | null,
): TypesenseSearchRequest[] {
  if (f.isAll) {
    return [{ q: '*', filter_by: scopeFilter, sort_by: allSortBy, per_page: perPage }];
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
      sort_by: '_text_match:desc,quality_score:desc,ord:asc',
      per_page: perPage,
    });
  }
  if (orExpr) {
    out.push({
      q: '*',
      filter_by: `${scopeFilter} && (${orExpr})`,
      sort_by: 'quality_score:desc,ord:asc',
      per_page: perPage,
    });
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
  const base = `vertical:=${escapeTypesenseFilterValue(f.vertical)}`;
  const perPage = Math.min(MAX_PER_PAGE, Math.max(10, f.limit ?? DEFAULT_LIMIT));
  const fallbackLimit = Math.min(FALLBACK_PER_PAGE, perPage);
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
    out.push(...buildScopeSearches(f, `${base} && has_place:=false`, fallbackLimit, allSortBy, orExpr));
  }

  // 4. Địa điểm lân cận trong bán kính FAR_KM (150 km).
  if (f.center) {
    const geoScope = `${base} && location(${f.center.lat}, ${f.center.lon}, ${FAR_KM} km)`;
    out.push(...buildScopeSearches(f, geoScope, fallbackLimit, allSortBy, orExpr));
  }

  return out;
}
