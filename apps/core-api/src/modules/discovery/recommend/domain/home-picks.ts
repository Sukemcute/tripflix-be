import { PLACES } from '../../search/domain/places.js';
import { resolvePlaceSlugs } from '../../search/domain/stays.js';

/** Khách sạn có giá trong 30 ngày tới, đủ để gợi ý. */
export interface HomeCandidate {
  hotelId: string;
  name: string;
  thumbnail: string | null;
  stars: number | null;
  /** Chuỗi khách sạn (Mường Thanh, Vinpearl…); null là khách sạn độc lập, không giới hạn số lần. */
  brand: string | null;
  province: { slug: string; name: string };
  /** Giá thấp nhất một đêm một phòng trong 30 ngày tới. */
  priceFrom: number;
}

export type HomeReasonCode = 'recent_place' | 'good_deal';

export interface HomePick extends HomeCandidate {
  reason: { code: HomeReasonCode; text: string };
}

/** Số nơi vừa tìm được dùng, số khách sạn mỗi nơi. */
export const MAX_RECENT_PLACES = 3;
const PICKS_PER_RECENT_PLACE = 2;
/** Chỉ gọi là "giá tốt" khi rẻ hơn trung vị cùng hạng ít nhất chừng này phần trăm. */
const MIN_DEAL_PERCENT = 10;
/** Hạng sao cần ít nhất chừng này khách sạn thì trung vị mới có nghĩa. */
const MIN_TIER_SIZE = 3;

const byValue = (a: HomeCandidate, b: HomeCandidate) => (b.stars ?? 0) - (a.stars ?? 0) || a.priceFrom - b.priceFrom;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Khối "Gợi ý dành cho bạn" trên trang chủ web, tuần 1: chỉ dùng lý do đúng sự thật tính được từ danh mục.
 * 1. Nơi người dùng vừa tìm (web tự nhớ ở trình duyệt): tối đa 2 khách sạn mỗi nơi, nhiều sao và rẻ trước.
 * 2. Giá tốt: rẻ hơn trung vị cùng hạng sao ít nhất 10%, mỗi tỉnh và mỗi chuỗi một khách sạn cho đa dạng.
 * ponytail: chưa có lượt xem, lượt đặt nên chưa có "xu hướng" thật; thêm lý do mới khi analytics có dữ liệu (TF28).
 */
export function pickHomeRecommendations(candidates: readonly HomeCandidate[], recentPlaceIds: readonly string[], limit: number): HomePick[] {
  const picks: HomePick[] = [];
  const usedHotels = new Set<string>();
  const usedSlugs = new Set<string>();
  const usedBrands = new Set<string>();
  const add = (hotel: HomeCandidate, code: HomeReasonCode, text: string) => {
    picks.push({ ...hotel, reason: { code, text } });
    usedHotels.add(hotel.hotelId);
    usedSlugs.add(hotel.province.slug);
    if (hotel.brand) usedBrands.add(hotel.brand);
  };

  const recentPlaces = [...new Set(recentPlaceIds)].flatMap((id) => {
    const place = PLACES.find((p) => p.id === id);
    const slugs = resolvePlaceSlugs(id);
    return place && slugs ? [{ name: place.name, slugs }] : [];
  });
  for (const place of recentPlaces.slice(0, MAX_RECENT_PLACES)) {
    const inPlace = candidates.filter((h) => place.slugs.includes(h.province.slug) && !usedHotels.has(h.hotelId)).sort(byValue);
    for (const hotel of inPlace.slice(0, PICKS_PER_RECENT_PLACE)) add(hotel, 'recent_place', `Vì bạn vừa tìm ${place.name}`);
  }

  const tiers = new Map<number, number[]>();
  for (const h of candidates) if (h.stars !== null) tiers.set(h.stars, [...(tiers.get(h.stars) ?? []), h.priceFrom]);
  const deals = candidates
    .flatMap((h) => {
      const prices = h.stars === null ? undefined : tiers.get(h.stars);
      if (!prices || prices.length < MIN_TIER_SIZE) return [];
      const percent = Math.round((1 - h.priceFrom / median(prices)) * 100);
      return percent >= MIN_DEAL_PERCENT ? [{ hotel: h, percent }] : [];
    })
    .sort((a, b) => b.percent - a.percent || byValue(a.hotel, b.hotel));
  for (const { hotel, percent } of deals) {
    if (picks.length >= limit) break;
    if (usedHotels.has(hotel.hotelId) || usedSlugs.has(hotel.province.slug)) continue;
    if (hotel.brand && usedBrands.has(hotel.brand)) continue;
    add(hotel, 'good_deal', `Rẻ hơn ${percent}% so với giá trung bình khách sạn ${hotel.stars} sao`);
  }

  return picks.slice(0, limit);
}
