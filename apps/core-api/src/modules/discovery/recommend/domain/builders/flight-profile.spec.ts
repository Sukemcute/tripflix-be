import { describe, expect, it } from 'vitest';
import type { FlightBuildItem } from '../contracts.js';
import { FlightProfileV0FeaturesSchema, flightMinutes, flightProfileV0, type FlightProfileFeatures } from './flight-profile.js';

const flight = (flightKey: string, extra: Partial<FlightBuildItem> = {}): FlightBuildItem => ({
  flightKey,
  fromAirport: 'SGN',
  toAirport: 'CXR',
  airline: 'VN',
  departTime: '06:45',
  arriveTime: '08:20',
  priceFrom: 900_000,
  hasRefundableFare: false,
  bookings30d: 0,
  ...extra,
});

async function build(flights: FlightBuildItem[]) {
  const out = await flightProfileV0.build({ flights }, new Date('2026-11-17T00:00:00Z'));
  for (const o of out) FlightProfileV0FeaturesSchema.parse(o.features);
  return new Map(out.map((o) => [o.productId, { groupKey: o.groupKey, score: o.score, f: o.features as FlightProfileFeatures }]));
}

describe('flight_profile@v0', () => {
  it('so giá và tốc độ trong cùng tuyến; tuyến khác không tính chung', async () => {
    const r = await build([
      flight('RE', { priceFrom: 800_000, departTime: '06:00', arriveTime: '08:00' }),
      flight('NHANH', { priceFrom: 1_000_000, departTime: '10:00', arriveTime: '11:20' }),
      flight('DAT', { priceFrom: 1_500_000, departTime: '15:00', arriveTime: '16:40' }),
      flight('TUYEN-KHAC', { fromAirport: 'HAN', priceFrom: 100_000 }),
    ]);
    expect(r.get('RE')!).toMatchObject({ groupKey: 'SGN-CXR', f: { priceTier: 0, durationMinutes: 120, speedRank: 1 } });
    expect(r.get('NHANH')!.f).toMatchObject({ priceTier: 0.5, speedRank: 0 });
    expect(r.get('DAT')!.f.priceTier).toBe(1);
    expect(r.get('TUYEN-KHAC')!.f).toMatchObject({ route: 'HAN-CXR', priceTier: null, speedRank: null });
  });

  it('mọi chuyến bay lâu như nhau: speedRank null (không có "bay nhanh")', async () => {
    const r = await build([flight('A'), flight('B', { departTime: '17:00', arriveTime: '18:35' })]);
    expect(r.get('A')!.f.speedRank).toBeNull();
  });

  it('popularity theo lượt đặt; điểm chung: rẻ và được đặt nhiều cao hơn', async () => {
    const r = await build([flight('RE-DAT-NHIEU', { priceFrom: 700_000, bookings30d: 4 }), flight('DAT-IT', { priceFrom: 1_400_000, bookings30d: 1 })]);
    expect([r.get('RE-DAT-NHIEU')!.f.popularity, r.get('DAT-IT')!.f.popularity]).toEqual([1, 0.25]);
    expect(r.get('RE-DAT-NHIEU')!.score).toBeGreaterThan(r.get('DAT-IT')!.score);
  });
});

describe('flightMinutes', () => {
  it('tính qua nửa đêm, thiếu giờ thì null', () => {
    expect(flightMinutes('06:45', '08:20')).toBe(95);
    expect(flightMinutes('23:30', '01:00')).toBe(90);
    expect(flightMinutes(null, '08:00')).toBeNull();
  });
});
