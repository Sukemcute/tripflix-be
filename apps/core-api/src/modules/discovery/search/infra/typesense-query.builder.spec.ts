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
      filter_by: 'vertical:=`eats`',
      sort_by: 'location(10.77,106.7):asc,quality_score:desc,ord:asc',
    });
  });

  it('không có place và !isAll: tạo Search A (BM25) + Search B (exact terms/streets/tiers/days)', () => {
    const searches = buildTypesenseSearches(
      baseFilter({ vertical: 'stays', terms: ['resort'], tiers: ['cao cap'], days: 3, queryText: 'resort' }),
    );
    expect(searches).toHaveLength(2);
    expect(searches[0]!.q).toBe('resort');
    expect(searches[0]!.query_by).toContain('title_vi,title_folded');
    expect(searches[1]!.q).toBe('*');
    expect(searches[1]!.filter_by).toContain('terms:=[`resort`] || tier:=[`cao cap`] || days:=3');
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
    expect(filters.some((f) => f.includes(`location:(16.054, 108.202, ${FAR_KM} km)`))).toBe(true);
  });
});

describe('buildTypesenseSearches: ít search con, chỉ trả trường cần', () => {
  const daNang = {
    vertical: 'stays', isAll: false, terms: ['resort'], names: [], tiers: [], days: null,
    place: 'Đà Nẵng', places: ['Đà Nẵng'], placeTerms: ['da_nang'], center: { lat: 16.054, lon: 108.202 },
    latSpan: FAR_KM / 111, queryText: 'resort', limit: 100, user: null,
  } as CandidateFilter;

  it('câu có nơi và có từ: 3 phạm vi × 2 search; đúng nơi xếp trước bằng _eval; lân cận trừ đúng nơi', () => {
    const searches = buildTypesenseSearches(daNang);
    expect(searches).toHaveLength(6);
    expect(searches[0]).toMatchObject({
      filter_by: 'vertical:=`stays` && (place:=[`Đà Nẵng`] || has_place:=false)',
      sort_by: '_eval(place:=[`Đà Nẵng`]):desc,_text_match:desc,quality_score:desc',
      per_page: 100,
    });
    expect(searches[2]!.filter_by).toBe('vertical:=`stays` && has_place:=false && terms:=[`da_nang`]');
    expect(searches[4]!.filter_by).toBe(`vertical:=\`stays\` && location:(16.054, 108.202, ${FAR_KM} km) && place:!=[\`Đà Nẵng\`]`);
    expect(searches.every((s) => s.include_fields === 'id,doc_json')).toBe(true);
  });

  it('câu chỉ có nơi (isAll): không lấy bài chưa rõ nơi không nhắc nơi', () => {
    const searches = buildTypesenseSearches({ ...daNang, isAll: true, terms: [], queryText: '' });
    expect(searches.map((s) => s.filter_by)).toEqual([
      'vertical:=`stays` && place:=[`Đà Nẵng`]',
      'vertical:=`stays` && has_place:=false && terms:=[`da_nang`]',
      `vertical:=\`stays\` && location:(16.054, 108.202, ${FAR_KM} km) && place:!=[\`Đà Nẵng\`]`,
    ]);
  });
});
