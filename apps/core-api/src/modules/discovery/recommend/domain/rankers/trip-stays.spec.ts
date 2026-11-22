import { describe, expect, it } from 'vitest';
import type { HotelProfileFeatures } from '../builders/hotel-profile.js';
import { pickBudget, rankTripStays, type TripStayCandidate } from './trip-stays.js';

const profile = (extra: Partial<HotelProfileFeatures> = {}): HotelProfileFeatures => ({
  priceFrom: null,
  priceTier: null,
  valueRatio: null,
  ratingAverage: null,
  ratingCount: 0,
  ratingScore: null,
  nearestSightName: null,
  nearestSightKm: null,
  placesNearby: null,
  bookings30d: 0,
  popularity: 0,
  ...extra,
});

const stay = (hotelId: string, unitPrice: number, stars: number, p: Partial<HotelProfileFeatures> | null = {}): TripStayCandidate => ({
  hotelId,
  slug: null,
  name: hotelId,
  stars,
  thumbnail: null,
  province: { slug: 'nha-trang', name: 'Nha Trang' },
  unitPrice,
  totalPrice: unitPrice * 2,
  rating: null,
  profile: p === null ? null : profile(p),
});

// Mặt bằng Nha Trang: đa số 300k–900k/đêm, một khách sạn 6,28 triệu ngay cạnh điểm tham quan (ca Golden Rain).
const CANDIDATES = [
  stay('RE-1', 300_000, 2, { nearestSightName: 'Tháp Bà', nearestSightKm: 1.2, placesNearby: 12 }),
  stay('RE-2', 350_000, 2),
  stay('VUA-GAN', 600_000, 3, { nearestSightName: 'Tháp Bà', nearestSightKm: 0.2, placesNearby: 40, ratingAverage: 4.6, ratingCount: 200, ratingScore: 4.55 }),
  stay('VUA-2', 700_000, 3, { ratingAverage: 4.8, ratingCount: 300, ratingScore: 4.75 }),
  stay('BON-SAO-RE', 800_000, 4, { valueRatio: 0.7, bookings30d: 3, popularity: 1 }),
  stay('BON-SAO', 900_000, 4, { valueRatio: 1.1 }),
  stay('GOLDEN-RAIN', 6_280_000, 5, { nearestSightName: 'Chùa', nearestSightKm: 0.05, placesNearby: 56, ratingAverage: 4.7, ratingCount: 250, ratingScore: 4.68 }),
];
const group = (r: ReturnType<typeof rankTripStays>, code: string) => r.groups.find((g) => g.code === code)?.ids ?? [];

describe('trip_stays@v0', () => {
  it('ngân sách vừa phải (mặc định): khách sạn 6,28 triệu không lọt nhóm nào ngoài "giá tốt", dù ở sát điểm tham quan', () => {
    const r = rankTripStays({ candidates: CANDIDATES, perGroup: 4 });
    expect(r.budget).toBe('moderate');
    expect(r.items.find((s) => s.hotelId === 'GOLDEN-RAIN')).toBeUndefined();
    expect(group(r, 'near_sights')).toEqual(['VUA-GAN', 'RE-1']);
    expect(group(r, 'top_rated')).toEqual(['VUA-2', 'VUA-GAN']);
  });

  it('cao cấp: không có mốc giá, khách sạn đắt được xét như mọi khách sạn khác', () => {
    const r = rankTripStays({ candidates: CANDIDATES, budgetLevels: ['premium'], perGroup: 4 });
    expect(r.budgetAnchor).toBeNull();
    expect(group(r, 'near_sights')[0]).toBe('GOLDEN-RAIN');
    expect(r.items.find((s) => s.hotelId === 'GOLDEN-RAIN')!.budgetFit).toBe(1);
  });

  it('tiết kiệm: mốc thấp hơn, khách sạn 900k vượt ngân sách (vừa phải thì không)', () => {
    const only = (r: ReturnType<typeof rankTripStays>) => r.items.find((s) => s.hotelId === 'BON-SAO');
    // BON-SAO không lọt nhóm nào nên dùng perGroup lớn để "giá tốt" chứa mọi khách sạn.
    const moderate = rankTripStays({ candidates: CANDIDATES, budgetLevels: ['moderate'], perGroup: 10 });
    const saving = rankTripStays({ candidates: CANDIDATES, budgetLevels: ['saving'], perGroup: 10 });
    expect(saving.budgetAnchor).toBe(550_000);
    expect(moderate.budgetAnchor).toBe(760_000);
    expect(only(moderate)!.budgetFit).toBe(1);
    expect(only(saving)!.budgetFit).toBeLessThan(0.5);
  });

  it('thứ tự chip theo ngân sách: cao cấp xem đánh giá cao trước, giá tốt cuối', () => {
    expect(rankTripStays({ candidates: CANDIDATES, budgetLevels: ['premium'], perGroup: 4 }).groups.map((g) => g.code)).toEqual([
      'top_rated',
      'value',
      'near_sights',
      'lively',
      'popular',
      'cheap',
    ]);
    expect(rankTripStays({ candidates: CANDIDATES, perGroup: 4 }).groups[0]!.code).toBe('cheap');
  });

  it('giá một đêm lẻ được làm tròn tới nghìn khi hiện', () => {
    const r = rankTripStays({ candidates: [stay('LE', 353_333, 2)], perGroup: 4 });
    expect(r.items[0]!.badges).toEqual([{ code: 'cheap', text: '353.000đ/đêm' }]);
  });

  it('đáng tiền: từ 4 sao và rẻ hơn mặt bằng cùng hạng sao', () => {
    const r = rankTripStays({ candidates: CANDIDATES, perGroup: 4 });
    expect(group(r, 'value')).toEqual(['BON-SAO-RE']);
    expect(r.items.find((s) => s.hotelId === 'BON-SAO-RE')!.badges).toContainEqual({ code: 'value', text: '4★ rẻ hơn 30% so với khách sạn 4★ cùng nơi' });
  });

  it('được đặt nhiều: chỉ khách sạn có lượt đặt', () => {
    expect(group(rankTripStays({ candidates: CANDIDATES, perGroup: 4 }), 'popular')).toEqual(['BON-SAO-RE']);
  });

  it('khách sạn chưa có hồ sơ: vẫn có ở "giá tốt", không vào nhóm cần hồ sơ', () => {
    const r = rankTripStays({ candidates: [stay('MOI', 200_000, 4, null), ...CANDIDATES], perGroup: 4 });
    expect(r.items.find((s) => s.hotelId === 'MOI')!.badges.map((b) => b.code)).toEqual(['cheap']);
  });

  it('không có ứng viên: không có nhóm', () => {
    expect(rankTripStays({ candidates: [], perGroup: 4 })).toEqual({ items: [], groups: [], budgetAnchor: null, budget: 'moderate' });
  });
});

describe('pickBudget', () => {
  it('chọn mức thoáng nhất; không chọn gì thì dùng mặc định', () => {
    expect(pickBudget(['saving', 'premium'], 'moderate')).toBe('premium');
    expect(pickBudget(['saving'], 'moderate')).toBe('saving');
    expect(pickBudget([], 'moderate')).toBe('moderate');
    expect(pickBudget(null, 'saving')).toBe('saving');
  });
});
