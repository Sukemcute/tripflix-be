import { z } from 'zod';
import { round4, type FlightBuilder, type FlightBuildItem, type ProductBuildOutput } from '../contracts.js';
import { groupBy } from '../group-by.js';

export const FlightProfileV0FeaturesSchema = z.object({
  route: z.string(),
  departTime: z.string().nullable(),
  arriveTime: z.string().nullable(),
  /** Phút bay; null khi thiếu giờ. */
  durationMinutes: z.number().nullable(),
  /** 0 nhanh nhất tuyến, 1 chậm nhất; null khi mọi chuyến trên tuyến bay lâu như nhau (không có gì để so). */
  speedRank: z.number().nullable(),
  priceFrom: z.number().nullable(),
  /** Phân vị giá thấp nhất 30 ngày trên cùng tuyến: 0 rẻ nhất, 1 đắt nhất; null khi tuyến có < 2 chuyến có giá. */
  priceTier: z.number().nullable(),
  hasRefundableFare: z.boolean(),
  bookings30d: z.number(),
  /** bookings30d chia cho lượt đặt lớn nhất trong lô: 0..1. */
  popularity: z.number(),
});
export type FlightProfileFeatures = z.infer<typeof FlightProfileV0FeaturesSchema>;

/** Phút bay từ giờ "HH:MM"; tới sau nửa đêm thì cộng một ngày. Thiếu giờ thì null. */
export function flightMinutes(departTime: string | null, arriveTime: string | null): number | null {
  if (!departTime || !arriveTime) return null;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(arriveTime) - toMin(departTime);
  return diff >= 0 ? diff : diff + 24 * 60;
}

const routeOf = (f: Pick<FlightBuildItem, 'fromAirport' | 'toAirport'>) => `${f.fromAirport}-${f.toAirport}`;

/**
 * flight_profile@v0: hồ sơ từng chuyến so với các chuyến cùng tuyến (giá, tốc độ), giờ bay, có vé hoàn huỷ, độ được đặt.
 * Không phụ thuộc người xem hay ngày bay: ranker trip_flights@v0 ghép với giá thật của ngày, ngân sách, lịch phòng.
 */
export const flightProfileV0: FlightBuilder = {
  key: 'flight_profile@v0',
  productType: 'flight',
  featuresSchema: FlightProfileV0FeaturesSchema,
  build: ({ flights }) => {
    const maxBookings = Math.max(0, ...flights.map((f) => f.bookings30d));
    const byRoute = groupBy(flights, routeOf);
    const out: ProductBuildOutput[] = [];
    for (const [route, peers] of byRoute) {
      const prices = peers.flatMap((p) => (p.priceFrom === null ? [] : [p.priceFrom]));
      const minutes = peers.flatMap((p) => {
        const m = flightMinutes(p.departTime, p.arriveTime);
        return m === null ? [] : [m];
      });
      const fastest = Math.min(...minutes);
      const slowest = Math.max(...minutes);
      for (const f of peers) {
        const durationMinutes = flightMinutes(f.departTime, f.arriveTime);
        const priceTier = f.priceFrom === null || prices.length < 2 ? null : round4(prices.filter((p) => p < f.priceFrom!).length / (prices.length - 1));
        const popularity = maxBookings > 0 ? round4(f.bookings30d / maxBookings) : 0;
        const features: FlightProfileFeatures = {
          route,
          departTime: f.departTime,
          arriveTime: f.arriveTime,
          durationMinutes,
          speedRank: durationMinutes === null || slowest === fastest ? null : round4((durationMinutes - fastest) / (slowest - fastest)),
          priceFrom: f.priceFrom,
          priceTier,
          hasRefundableFare: f.hasRefundableFare,
          bookings30d: f.bookings30d,
          popularity,
        };
        // Chất lượng chung: rẻ so với tuyến là chính, được đặt nhiều cộng thêm.
        const score = round4(0.6 * (1 - (priceTier ?? 0.5)) + 0.4 * popularity);
        out.push({ productId: f.flightKey, groupKey: route, score, features });
      }
    }
    return Promise.resolve(out);
  },
};
