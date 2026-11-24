import { tasteOf } from './candidates.js';

describe('tasteOf: gu nổi bật làm nguồn ứng viên', () => {
  it('lấy tối đa 3 nơi, 5 tag nặng nhất, bỏ trọng số < 0,2', () => {
    const taste = tasteOf({
      places: { 'da-lat': 1, 'nha-trang': 0.5, 'ha-noi': 0.3, 'hoi-an': 0.25, 'sa-pa': 0.1 },
      tags: { danang: 1, nhatrang: 0.8, cafe: 0.4, camping: 0.43, resort: 0.36, homestay: 0.5, phoco: 0.07 },
    });
    expect(taste).toEqual({ places: ['da-lat', 'nha-trang', 'ha-noi'], tags: ['danang', 'nhatrang', 'homestay', 'camping', 'cafe'] });
  });

  it('trip_profile@v1: đọc answers.place / answers.exp, bỏ tiền tố ngăn', () => {
    const taste = tasteOf({
      answers: { place: { 'place:da-lat': 0.69, 'place:lam-dong': 0.69 }, exp: { 'exp:nui': 0.61 }, with: { 'with:cap_doi': 0.38 } },
      interactionCount: 2,
    });
    expect(taste).toEqual({ places: ['da-lat', 'lam-dong'], tags: ['nui'] });
  });

  it('không có gu đủ nặng thì null', () => {
    expect(tasteOf(null)).toBeNull();
    expect(tasteOf({ places: { 'da-lat': 0.05 }, tags: {} })).toBeNull();
  });
});
