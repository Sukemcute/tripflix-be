import { FAR_KM } from '../domain/explore/rank.js';
import type { CandidateFilter } from '../domain/explore/types.js';
import { buildTypesenseSearches } from './typesense-query.builder.js';

const baseFilter = (over: Partial<CandidateFilter> = {}): CandidateFilter => ({
  vertical: 'eats',
  isAll: false,
  terms: ['pho'],
  names: [],
  tiers: [],
  days: null,
  place: null,
  places: [],
  placeTerms: [],
  center: null,
  latSpan: FAR_KM / 111,
  queryText: 'phở',
  limit: 100,
  user: null,
  ...over,
});

describe('buildTypesenseSearches', () => {
  it('không có place và isAll=true: tạo 1 search q="*" ưu tiên vị trí người dùng nếu có', () => {
    const searches = buildTypesenseSearches(
      baseFilter({ isAll: true, terms: [], queryText: '', user: { lat: 10.77, lon: 106.7 } }),
    );
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      q: '*',
      filter_by: 'is_hidden:=false && vertical:=`eats`',
      sort_by: 'location(10.77,106.7):asc,quality_score:desc,ord:asc',
    });
  });

  it('không có place và !isAll: tạo Search A (BM25) + Search B (exact terms/streets/tiers/days)', () => {
    const searches = buildTypesenseSearches(
      baseFilter({ vertical: 'stays', terms: ['resort'], tiers: ['cao cap'], days: 3, queryText: 'resort' }),
    );
    expect(searches).toHaveLength(4); // 2 search × 2 trang (trần 500)
    expect(searches[0]!.q).toBe('resort');
    expect(searches[0]!.query_by).toContain('title_vi,title_folded');
    expect(searches[2]!.q).toBe('*');
    expect(searches[2]!.filter_by).toContain('terms:=[`resort`] || tier:=[`cao cap`] || days:=3');
  });

  it('có place: tách riêng đúng nơi, nhắc nơi (has_place:=false), chưa rõ nơi fallback, và lân cận 150km', () => {
    const searches = buildTypesenseSearches(
      baseFilter({
        place: 'Đà Nẵng',
        places: ['Đà Nẵng'],
        placeTerms: ['da_nang', 'danang'],
        center: { lat: 16.054, lon: 108.202 },
      }),
    );
    const filters = searches.map((s) => s.filter_by ?? '');
    expect(filters.some((f) => f.includes('place:=[`Đà Nẵng`]'))).toBe(true);
    expect(filters.some((f) => f.includes('has_place:=false && terms:=[`da_nang`,`danang`]'))).toBe(true);
    expect(filters.some((f) => f.includes('has_place:=false') && !f.includes('`da_nang`'))).toBe(true);
    expect(filters.some((f) => f.includes(`location(16.054, 108.202, ${FAR_KM} km)`))).toBe(true);
  });

  it('cùng trần ứng viên với Postgres: câu có từ lấy 500 (2 trang × 250), câu rỗng lấy 100', () => {
    const [p1, p2, ...rest] = buildTypesenseSearches(baseFilter({ names: [], terms: [] }));
    expect(rest).toHaveLength(0);
    expect([p1, p2].map((r) => [r!.per_page, r!.page])).toEqual([[250, 1], [250, 2]]);
    const [empty] = buildTypesenseSearches(baseFilter({ isAll: true, terms: [], queryText: '' }));
    expect(empty).toMatchObject({ per_page: 100 });
    expect(empty!.page).toBeUndefined();
  });
});
