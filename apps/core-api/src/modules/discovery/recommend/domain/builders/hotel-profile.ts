import { z } from 'zod';
import { normalizeText } from '../../../search/domain/normalize-text.js';
import { distanceKm } from '../../../search/domain/points-of-interest.js';
import { round4, type HotelBuilder, type HotelBuildInput, type HotelBuildItem, type ProductBuildOutput } from '../contracts.js';
import { percentile } from './hot.js';

export const HotelProfileV0FeaturesSchema = z.object({
  priceFrom: z.number().nullable(),
  /** Phân vị giá so với khách sạn cùng thành phố (đủ MIN_CITY_PEERS), không thì cùng tỉnh: 0 rẻ nhất, 1 đắt nhất. */
  priceTier: z.number().nullable(),
  /** Giá so với trung vị khách sạn cùng hạng sao cùng thành phố: dưới 1 là rẻ hơn mặt bằng. Thành phố không đủ MIN_CITY_PEERS khách sạn, hoặc ít hơn MIN_PEERS khách sạn cùng sao, thì null. */
  valueRatio: z.number().nullable(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number(),
  /** Điểm đánh giá kéo về trung bình tỉnh theo số lượt (1–5). */
  ratingScore: z.number().nullable(),
  nearestSightName: z.string().nullable(),
  nearestSightKm: z.number().nullable(),
  /** Số điểm tham quan, quán ăn, cà phê trong LIVELY_RADIUS_KM. Null khi quanh khách sạn không có dữ liệu địa điểm. */
  placesNearby: z.number().nullable(),
  bookings30d: z.number(),
  /** bookings30d chia cho số lượt đặt lớn nhất trong lô: 0..1. */
  popularity: z.number(),
  /** Kiểu khách sạn của commerce (biển, núi, resort…): gộp theo nơi thành hồ sơ chủ đề của nơi. Hồ sơ cũ không có. */
  style: z.string().nullable().optional(),
});
export type HotelProfileFeatures = z.infer<typeof HotelProfileV0FeaturesSchema>;

export const LIVELY_RADIUS_KM = 1.5;
/** Không có điểm nào trong bán kính này thì coi như nơi đó chưa có dữ liệu địa điểm (khác với "vắng"). */
const POI_COVERAGE_KM = 30;
/** Số lượt đánh giá "ảo" kéo điểm về trung bình tỉnh: 5,0 với 3 đánh giá không vượt 4,8 với 300 đánh giá. */
const RATING_PRIOR_WEIGHT = 50;
const MIN_PEERS = 3;
/** Thành phố có ít khách sạn có giá hơn chừng này thì so với cả tỉnh. */
const MIN_CITY_PEERS = 5;

/** commerce ghi "Đà Nẵng", "Da Nang", "Danang" cho cùng một nơi: bỏ dấu, chữ thường, bỏ khoảng trắng. */
const cityKey = (city: string | null) => (city ? normalizeText(city).replace(/\s+/g, '') || null : null);

const median = (xs: number[]) => (xs.length ? percentile(xs, 50) : null);
const groupBy = <T>(xs: readonly T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

function geo(h: HotelBuildItem, input: HotelBuildInput) {
  if (!h.location || !input.points.length) return { nearestSightName: null, nearestSightKm: null, placesNearby: null };
  let nearestAny = Infinity;
  let sight: { name: string; km: number } | null = null;
  let placesNearby = 0;
  for (const p of input.points) {
    const d = distanceKm(h.location, p);
    nearestAny = Math.min(nearestAny, d);
    if (d <= LIVELY_RADIUS_KM) placesNearby += 1;
    if (p.kind === 'see' && (!sight || d < sight.km)) sight = { name: p.name, km: d };
  }
  if (nearestAny > POI_COVERAGE_KM) return { nearestSightName: null, nearestSightKm: null, placesNearby: null };
  return { nearestSightName: sight?.name ?? null, nearestSightKm: sight ? round4(sight.km) : null, placesNearby };
}

/**
 * hotel_profile@v0: hồ sơ từng khách sạn so với khách sạn cùng tỉnh (giá, đáng tiền, đánh giá), vị trí so với chỗ đi chơi,
 * và độ được đặt. Không phụ thuộc người xem hay ngày ở: ranker trip_stays@v0 ghép với giá thật của ngày và ngân sách.
 */
export const hotelProfileV0: HotelBuilder = {
  key: 'hotel_profile@v0',
  productType: 'hotel',
  featuresSchema: HotelProfileV0FeaturesSchema,
  build: (input) => {
    const byProvince = groupBy(input.hotels, (h) => h.provinceSlug);
    const maxBookings = Math.max(0, ...input.hotels.map((h) => h.bookings30d));
    const out: ProductBuildOutput[] = [];
    for (const [provinceSlug, hotels] of byProvince) {
      const rated = hotels.filter((h) => h.rating && h.rating.count > 0);
      const prior = rated.length ? rated.reduce((s, h) => s + h.rating!.average, 0) / rated.length : null;
      const priced = hotels.filter((h) => h.priceFrom !== null);
      const byCity = groupBy(
        priced.filter((h) => cityKey(h.city)),
        (h) => cityKey(h.city)!,
      );
      // Sau sáp nhập tỉnh, Tam Kỳ, Hội An cùng tỉnh với Đà Nẵng: so giá trong cùng thành phố khi đủ khách sạn.
      const peersOf = (h: HotelBuildItem) => {
        const city = byCity.get(cityKey(h.city) ?? '');
        return city && city.length >= MIN_CITY_PEERS ? city : priced;
      };
      const starMedianIn = (peers: HotelBuildItem[], stars: number | null) => {
        const same = peers.filter((p) => p.stars === stars).map((p) => p.priceFrom!);
        return same.length >= MIN_PEERS ? median(same) : null;
      };
      for (const h of hotels) {
        const peers = peersOf(h);
        const prices = peers.map((p) => p.priceFrom!);
        // Phân vị: tỉ lệ khách sạn so sánh rẻ hơn hẳn khách sạn này.
        const priceTier = h.priceFrom === null || prices.length < 2 ? null : round4(prices.filter((p) => p < h.priceFrom!).length / (prices.length - 1));
        // "Đáng tiền" chỉ khi so được với khách sạn cùng thành phố: Tam Kỳ (ít khách sạn) so với cả tỉnh thì rẻ hơn Đà Nẵng
        // chỉ vì ở xa, không phải đáng tiền. Khách sạn không ghi thành phố thì so cả tỉnh.
        const canCompare = peers !== priced || !cityKey(h.city);
        const starMedian = canCompare ? starMedianIn(peers, h.stars) : null;
        const ratingScore =
          h.rating && h.rating.count > 0 && prior !== null
            ? round4((h.rating.average * h.rating.count + prior * RATING_PRIOR_WEIGHT) / (h.rating.count + RATING_PRIOR_WEIGHT))
            : null;
        const popularity = maxBookings > 0 ? round4(h.bookings30d / maxBookings) : 0;
        const features: HotelProfileFeatures = {
          priceFrom: h.priceFrom,
          priceTier,
          valueRatio: h.priceFrom !== null && starMedian ? round4(h.priceFrom / starMedian) : null,
          ratingAverage: h.rating?.average ?? null,
          ratingCount: h.rating?.count ?? 0,
          ratingScore,
          ...geo(h, input),
          bookings30d: h.bookings30d,
          popularity,
          style: h.style ?? null,
        };
        // Chất lượng chung để sắp khi không có tiêu chí nào khác: đánh giá là chính, được đặt nhiều cộng thêm.
        const score = round4(0.7 * (ratingScore === null ? 0 : (ratingScore - 1) / 4) + 0.3 * popularity);
        out.push({ productId: h.hotelId, groupKey: provinceSlug, score, features });
      }
    }
    return Promise.resolve(out);
  },
};
