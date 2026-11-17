import { describe, expect, it } from 'vitest';
import type { FlightProfileFeatures } from '../builders/flight-profile.js';
import { rankTripFlights, type TripFlightCandidate } from './trip-flights.js';

const profile = (extra: Partial<FlightProfileFeatures> = {}): FlightProfileFeatures => ({
  route: 'SGN-CXR',
  departTime: null,
  arriveTime: null,
  durationMinutes: 95,
  speedRank: null,
  priceFrom: null,
  priceTier: null,
  hasRefundableFare: false,
  bookings30d: 0,
  popularity: 0,
  ...extra,
});

const quote = (flightKey: string, unitPrice: number, departTime: string, arriveTime: string, p: Partial<FlightProfileFeatures> | null = {}): TripFlightCandidate => ({
  flightKey,
  productId: `${flightKey}--Y`,
  ratePlanCode: 'ECO',
  name: flightKey,
  airline: null,
  fromAirport: 'SGN',
  toAirport: 'CXR',
  date: '2026-12-01',
  departTime,
  arriveTime,
  unitPrice,
  totalPrice: unitPrice * 2,
  profile: p === null ? null : profile(p),
});

const QUOTES = [
  quote('SOM', 700_000, '05:30', '06:40', { durationMinutes: 70, speedRank: 0 }),
  quote('DEP', 900_000, '08:00', '09:35', { durationMinutes: 95, speedRank: 0.5, hasRefundableFare: true }),
  quote('TOI', 800_000, '19:00', '20:10', { durationMinutes: 70, speedRank: 0, bookings30d: 2, popularity: 1 }),
  quote('CHAM', 1_500_000, '10:00', '13:30', { durationMinutes: 210, speedRank: 1 }),
];
const ids = (r: ReturnType<typeof rankTripFlights>, code: string) => r.groups.find((g) => g.code === code)?.ids;

describe('trip_flights@v0', () => {
  it('chiều đi: giờ đẹp là cất cánh từ 6:00 và tới trước 14:00; bay nhanh theo phút bay; vé đắt vượt ngân sách bị loại khỏi nhóm', () => {
    const r = rankTripFlights({ candidates: QUOTES, leg: 'outbound', perGroup: 2 });
    expect(ids(r, 'cheapest')).toEqual(['SOM', 'TOI']);
    // CHAM 1,5 triệu vượt 1,3 × mốc nên không vào "giờ đẹp" dù tới 13:30.
    expect(ids(r, 'good_time')).toEqual(['DEP']);
    expect(ids(r, 'fastest')).toEqual(['SOM', 'TOI']);
    expect(ids(r, 'flexible')).toEqual(['DEP']);
    expect(ids(r, 'popular')).toEqual(['TOI']);
    expect(r.items.find((q) => q.flightKey === 'DEP')!.badges).toContainEqual({ code: 'good_time', text: 'Tới 09:35, kịp nhận phòng' });
    // Mọi chuyến vẫn có trong danh sách (đủ minOptions), rẻ trước.
    expect(r.items.map((q) => q.flightKey)).toEqual(['SOM', 'TOI', 'DEP', 'CHAM']);
  });

  it('cao cấp: không có mốc giá, chip giờ đẹp đứng đầu, chuyến đắt vào được nhóm', () => {
    const r = rankTripFlights({ candidates: QUOTES, leg: 'outbound', budgetLevels: ['premium'], perGroup: 3 });
    expect(r.groups[0]!.code).toBe('good_time');
    expect(ids(r, 'good_time')).toEqual(['DEP', 'CHAM']);
  });

  it('chiều về: giờ đẹp là cất cánh từ 13:00', () => {
    expect(ids(rankTripFlights({ candidates: QUOTES, leg: 'inbound', perGroup: 3 }), 'good_time')).toEqual(['TOI']);
  });

  it('mọi chuyến bay lâu như nhau (speedRank null) hoặc chưa có hồ sơ: không có nhóm bay nhanh', () => {
    const r = rankTripFlights({ candidates: [quote('A', 900_000, '06:45', '08:20'), quote('B', 1_000_000, '17:00', '18:35', null)], leg: 'outbound', perGroup: 3 });
    expect(r.groups.map((g) => g.code)).toEqual(['cheapest', 'good_time']);
  });

  it('mọi chuyến đều có vé hoàn huỷ: không có nhóm này (không giúp chọn)', () => {
    const all = [quote('A', 900_000, '06:45', '08:20', { hasRefundableFare: true }), quote('B', 1_000_000, '17:00', '18:35', { hasRefundableFare: true })];
    expect(rankTripFlights({ candidates: all, leg: 'outbound', perGroup: 3 }).groups.map((g) => g.code)).not.toContain('flexible');
  });

  it('không có chuyến: không có nhóm', () => {
    expect(rankTripFlights({ candidates: [], leg: 'outbound', perGroup: 3 })).toEqual({ items: [], groups: [], budgetAnchor: null, budget: 'moderate' });
  });
});
