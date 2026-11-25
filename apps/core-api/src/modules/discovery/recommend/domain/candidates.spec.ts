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
    // lam-dong là tỉnh cha của da-lat (trip_profile cộng cả hai): bỏ để dành chỗ cho nơi khác.
    expect(taste).toEqual({ places: ['da-lat'], tags: ['nui'] });
  });

  it('trip_profile lưu tổng thô: ngưỡng theo tỉ lệ trên mục nặng nhất (≥ 20%)', () => {
    const taste = tasteOf({ answers: { place: {}, exp: { 'exp:an_uong': 21, 'exp:nui': 5, 'exp:bien': 3 } } });
    expect(taste).toEqual({ places: [], tags: ['an_uong', 'nui'] });
  });

  it('không có gu thì null', () => {
    expect(tasteOf(null)).toBeNull();
    expect(tasteOf({ places: { 'da-lat': 0 }, tags: {} })).toBeNull();
  });
});
