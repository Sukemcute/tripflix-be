import { describe, expect, it } from 'vitest';
import type { HotelBuildItem, HotelPoint } from '../contracts.js';
import { HotelProfileV0FeaturesSchema, hotelProfileV0, type HotelProfileFeatures } from './hotel-profile.js';

// 0,01 độ vĩ ≈ 1,1 km quanh (12.25, 109.19).
const at = (dLat: number) => ({ lat: 12.25 + dLat, lng: 109.19 });
const hotel = (hotelId: string, extra: Partial<HotelBuildItem> = {}): HotelBuildItem => ({
  hotelId,
  provinceSlug: 'nha-trang',
  city: 'Nha Trang',
  stars: 3,
  priceFrom: 500_000,
  rating: null,
  location: at(0),
  bookings30d: 0,
  ...extra,
});
const point = (name: string, kind: HotelPoint['kind'], dLat: number): HotelPoint => ({ name, kind, ...at(dLat) });

const round = (x: number) => Math.round(x * 10_000) / 10_000;

async function build(hotels: HotelBuildItem[], points: HotelPoint[] = []) {
  const out = await hotelProfileV0.build({ hotels, points }, new Date('2026-11-17T00:00:00Z'));
  for (const o of out) HotelProfileV0FeaturesSchema.parse(o.features);
  return new Map(out.map((o) => [o.productId, { score: o.score, f: o.features as HotelProfileFeatures }]));
}

describe('hotel_profile@v0', () => {
  it('priceTier: phân vị giá trong tỉnh, tỉnh khác không tính chung', async () => {
    const r = await build([
      hotel('A', { priceFrom: 300_000 }),
      hotel('B', { priceFrom: 500_000 }),
      hotel('C', { priceFrom: 6_000_000 }),
      hotel('X', { priceFrom: 100_000, provinceSlug: 'da-lat' }),
    ]);
    expect([r.get('A')!.f.priceTier, r.get('B')!.f.priceTier, r.get('C')!.f.priceTier]).toEqual([0, 0.5, 1]);
    // Một mình một tỉnh: không có gì để so.
    expect(r.get('X')!.f.priceTier).toBeNull();
  });

  it('valueRatio: khách sạn không ghi thành phố so cả tỉnh, cần ít nhất 3 khách sạn cùng sao', async () => {
    const r = await build([
      hotel('S4-RE', { stars: 4, priceFrom: 800_000, city: null }),
      hotel('S4-A', { stars: 4, priceFrom: 1_000_000, city: null }),
      hotel('S4-B', { stars: 4, priceFrom: 1_200_000, city: null }),
      hotel('S5', { stars: 5, priceFrom: 3_000_000, city: null }),
    ]);
    expect(r.get('S4-RE')!.f.valueRatio).toBe(0.8);
    expect(r.get('S5')!.f.valueRatio).toBeNull();
  });

  it('so giá trong cùng thành phố (viết có dấu hay không đều cùng nơi): khách sạn xa trung tâm không thành "đáng tiền" giả', async () => {
    const city = (id: string, name: string, priceFrom: number) => hotel(id, { provinceSlug: 'da-nang', stars: 5, city: name, priceFrom });
    const r = await build([
      ...['Đà Nẵng', 'Da Nang', 'Danang', 'Đà Nẵng', 'Da Nang'].map((name, i) => city(`DN${i}`, name, 6_000_000 + i * 100_000)),
      ...['Hội An', 'Hoi An', 'Hội An', 'Hoi An', 'Hội An'].map((name, i) => city(`HA${i}`, name, 3_000_000 + i * 100_000)),
      city('TAM-KY', 'Tam Kỳ', 2_700_000),
    ]);
    // Hội An đủ 5 khách sạn: so trong Hội An, không bị coi là rẻ hơn ~50% so với Đà Nẵng.
    expect(r.get('HA0')!.f.valueRatio).toBe(round(3_000_000 / 3_200_000));
    // Tam Kỳ chỉ có 1 khách sạn: không so được trong thành phố nên không có "đáng tiền" (không so với cả tỉnh).
    expect(r.get('TAM-KY')!.f.valueRatio).toBeNull();
    // Phân vị giá vẫn tính trên cả tỉnh.
    expect(r.get('TAM-KY')!.f.priceTier).toBe(0);
  });

  it('ratingScore kéo về trung bình tỉnh: 5,0 với 3 đánh giá thấp hơn 4,8 với 300 đánh giá', async () => {
    const r = await build([hotel('IT', { rating: { average: 5, count: 3 } }), hotel('NHIEU', { rating: { average: 4.8, count: 300 } }), hotel('TB', { rating: { average: 4, count: 100 } })]);
    expect(r.get('NHIEU')!.f.ratingScore!).toBeGreaterThan(r.get('IT')!.f.ratingScore!);
    expect(r.get('NHIEU')!.score).toBeGreaterThan(r.get('IT')!.score);
  });

  it('vị trí: điểm tham quan gần nhất và số chỗ ăn chơi trong 1,5 km', async () => {
    const r = await build([hotel('TRUNG-TAM'), hotel('XA', { location: at(0.1) }), hotel('KHONG-TOA-DO', { location: null })], [
      point('Tháp Bà', 'see', 0.005),
      point('Quán 1', 'food', 0),
      point('Quán 2', 'cafe', 0.001),
    ]);
    expect(r.get('TRUNG-TAM')!.f).toMatchObject({ nearestSightName: 'Tháp Bà', placesNearby: 3 });
    expect(r.get('TRUNG-TAM')!.f.nearestSightKm!).toBeCloseTo(0.556, 2);
    expect(r.get('XA')!.f.placesNearby).toBe(0);
    expect(r.get('KHONG-TOA-DO')!.f).toMatchObject({ nearestSightName: null, nearestSightKm: null, placesNearby: null });
  });

  it('nơi chưa có dữ liệu địa điểm (điểm gần nhất xa hơn 30 km): null, không phải 0', async () => {
    const r = await build([hotel('A')], [point('Xa lắc', 'see', 1)]);
    expect(r.get('A')!.f).toMatchObject({ nearestSightKm: null, placesNearby: null });
  });

  it('popularity: lượt đặt chia cho lượt đặt lớn nhất', async () => {
    const r = await build([hotel('A', { bookings30d: 4 }), hotel('B', { bookings30d: 1 }), hotel('C')]);
    expect([r.get('A')!.f.popularity, r.get('B')!.f.popularity, r.get('C')!.f.popularity]).toEqual([1, 0.25, 0]);
  });
});
