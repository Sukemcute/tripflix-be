import { describe, expect, it } from 'vitest';
import { pickHomeRecommendations, type HomeCandidate } from './home-picks.js';

const hotel = (hotelId: string, slug: string, stars: number | null, priceFrom: number, brand: string | null = null): HomeCandidate => ({
  hotelId,
  name: hotelId,
  thumbnail: null,
  stars,
  brand,
  province: { slug, name: slug },
  priceFrom,
});

// Hạng 4 sao: trung vị 1.000.000 → "cheap4" rẻ hơn 40%, "fair4" chỉ rẻ hơn 5% (dưới ngưỡng 10%).
const catalog = [
  hotel('mid4a', 'ha-noi', 4, 1_000_000),
  hotel('mid4b', 'hue', 4, 1_000_000),
  hotel('high4', 'can-tho', 4, 1_500_000),
  hotel('cheap4', 'nha-trang', 4, 600_000),
  hotel('fair4', 'quy-nhon', 4, 950_000),
  hotel('cheap4-same-place', 'nha-trang', 4, 650_000),
  hotel('dl-5', 'da-lat', 5, 3_000_000),
  hotel('dl-3', 'da-lat', 3, 700_000),
  hotel('ld-4', 'lam-dong', 4, 1_200_000),
  hotel('dl-homestay', 'da-lat', 2, 500_000),
];

describe('pickHomeRecommendations', () => {
  it('nơi vừa tìm đứng trước: tỉnh gồm điểm đến con, nhiều sao trước, tối đa 2 mỗi nơi', () => {
    const picks = pickHomeRecommendations(catalog, ['lam-dong'], 8);
    expect(picks.slice(0, 2).map((p) => [p.hotelId, p.reason.text])).toEqual([
      ['dl-5', 'Vì bạn vừa tìm Lâm Đồng'],
      ['ld-4', 'Vì bạn vừa tìm Lâm Đồng'],
    ]);
  });

  it('giá tốt: chỉ khi rẻ hơn trung vị cùng hạng từ 10%, mỗi tỉnh một khách sạn, lý do ghi đúng phần trăm', () => {
    const picks = pickHomeRecommendations(catalog, [], 8);
    expect(picks.map((p) => p.hotelId)).toEqual(['cheap4']);
    expect(picks[0]!.reason).toEqual({ code: 'good_deal', text: 'Rẻ hơn 40% so với giá trung bình khách sạn 4 sao' });
  });

  it('bỏ nơi lạ và trùng, không lặp khách sạn, cắt theo limit', () => {
    const picks = pickHomeRecommendations(catalog, ['atlantis', 'nha-trang', 'nha-trang'], 2);
    expect(picks.map((p) => [p.hotelId, p.reason.code])).toEqual([
      ['cheap4', 'recent_place'],
      ['cheap4-same-place', 'recent_place'],
    ]);
  });

  it('giá tốt: mỗi chuỗi khách sạn một lần, khách sạn độc lập không tính là chuỗi', () => {
    const chain = [
      hotel('mt-a', 'phu-tho', 5, 1_000_000, 'Mường Thanh'),
      hotel('mt-b', 'ca-mau', 5, 1_100_000, 'Mường Thanh'),
      hotel('indie-a', 'hue', 5, 1_200_000),
      hotel('indie-b', 'vinh', 5, 1_250_000),
      hotel('x', 'ha-noi', 5, 3_000_000),
      hotel('y', 'can-tho', 5, 3_000_000),
      hotel('z', 'hai-phong', 5, 3_000_000),
      hotel('w', 'hue', 5, 3_000_000),
    ];
    // Trung vị 5 sao = 2.125.000. brand null là độc lập nên không bị giới hạn.
    expect(pickHomeRecommendations(chain, [], 8).map((p) => p.hotelId)).toEqual(['mt-a', 'indie-a', 'indie-b']);
  });

  it('không có nơi vừa tìm, không có giá tốt thì rỗng', () => {
    expect(pickHomeRecommendations([hotel('a', 'hue', 3, 1_000_000)], [], 8)).toEqual([]);
  });
});
