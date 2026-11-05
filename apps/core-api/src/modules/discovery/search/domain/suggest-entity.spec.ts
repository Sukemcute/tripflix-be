import { AIRPORTS } from './airports.js';
import { PLACES } from './places.js';
import { buildSuggestEntities, pickSuggestions, type SuggestType } from './suggest-entity.js';

const hotel = (id: string, slug: string, name = `Khách sạn ${id}`) => ({
  id,
  name,
  province: { slug, name: slug },
  stars: 4,
});

describe('buildSuggestEntities', () => {
  it('có đủ địa điểm, sân bay và khách sạn, id không trùng', () => {
    const entities = buildSuggestEntities([hotel('h1', 'da-lat'), hotel('h2', 'lam-dong')]);
    expect(entities).toHaveLength(PLACES.length + AIRPORTS.length + 2);
    expect(new Set(entities.map((e) => e.id)).size).toBe(entities.length);
  });

  it('khách sạn ở điểm đến được tính cho cả tỉnh cha', () => {
    const entities = buildSuggestEntities([hotel('h1', 'da-lat'), hotel('h2', 'lam-dong')]);
    const byId = new Map(entities.map((e) => [e.id, e]));
    expect(byId.get('place:da-lat')?.popularity).toBe(1);
    expect(byId.get('place:lam-dong')?.popularity).toBe(2);
    expect(byId.get('place:da-lat')?.subtitle).toBe('Lâm Đồng');
  });

  it('khách sạn có phụ đề theo cây địa điểm và chữ tìm đã bỏ dấu', () => {
    const [entity] = buildSuggestEntities([hotel('h1', 'phu-quoc', 'Sun Phú Quốc')]).filter((e) => e.type === 'hotel');
    expect(entity).toMatchObject({ refId: 'h1', placeId: 'phu-quoc', subtitle: 'Phú Quốc, An Giang', searchText: 'sun phu quoc' });
  });

  it('slug lạ không có trong cây thì lấy tên tỉnh commerce gửi', () => {
    const [entity] = buildSuggestEntities([{ ...hotel('h1', 'moi-them'), province: { slug: 'moi-them', name: 'Mới thêm' } }]).filter(
      (e) => e.type === 'hotel',
    );
    expect(entity?.subtitle).toBe('Mới thêm');
  });

  it('địa điểm tìm được bằng tên gọi khác', () => {
    const phuQuoc = buildSuggestEntities([]).find((e) => e.id === 'place:phu-quoc');
    expect(phuQuoc?.searchText.split(' ')).toContain('pq');
  });

  it('sân bay tìm được bằng mã và tên gọi khác của nơi có sân bay', () => {
    const tanSonNhat = buildSuggestEntities([]).find((e) => e.id === 'airport:SGN');
    expect(tanSonNhat?.searchText.split(' ')).toEqual(expect.arrayContaining(['sgn', 'hcm']));
  });

  it('mọi điểm đến và sân bay trỏ tới địa điểm có thật', () => {
    const ids = new Set(PLACES.map((p) => p.id));
    for (const place of PLACES) if (place.parentId) expect(ids).toContain(place.parentId);
    for (const airport of AIRPORTS) expect(ids).toContain(airport.placeId);
    expect(PLACES.filter((p) => p.kind === 'province')).toHaveLength(34);
  });
});

describe('pickSuggestions', () => {
  const ranked = (types: SuggestType[]) => types.map((type, rank) => ({ type, rank }));

  it('giữ hạn mức mỗi loại và thứ hạng ban đầu', () => {
    const picked = pickSuggestions(ranked(['hotel', 'place', 'place', 'place', 'place', 'airport', 'airport', 'hotel']), 5);
    expect(picked.map((p) => p.rank)).toEqual([0, 1, 2, 3, 5]);
  });

  it('loại nào thiếu thì lấy thêm loại khác cho đủ', () => {
    const picked = pickSuggestions(ranked(['place', 'place', 'place', 'place', 'place', 'place']), 8);
    expect(picked).toHaveLength(6);
  });

  it('không vượt giới hạn', () => {
    const picked = pickSuggestions(ranked(Array<SuggestType>(20).fill('hotel')));
    expect(picked).toHaveLength(8);
  });
});
