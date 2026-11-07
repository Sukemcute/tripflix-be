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

export interface HomeStayPick {
  hotelId: string;
  name: string;
  thumbnail: string | null;
  stars: number | null;
  brand: string | null;
  priceFrom: number;
  reason: { code: HomeReasonCode; text: string };
}

export interface HomeDestinationPick {
  province: { slug: string; name: string };
  /** Danh sách các khách sạn có giá/deal tốt tại điểm đến (deal tốt nhất đứng đầu) */
  hotels: HomeStayPick[];
  /** Tổng số khách sạn có deal hời trong 30 ngày tới tại điểm đến này */
  totalDealsCount: number;
  /** Số khách sạn có deal hời khác ngoài khách sạn đầu tiên (dùng để hiển thị: "còn ít nhất khoảng X khách sạn có deal hời nữa") */
  otherDealsCount: number;
}

/** Số nơi vừa tìm được dùng. */
export const MAX_RECENT_PLACES = 3;
/** Số khách sạn tối đa trả về trong danh sách mỗi điểm đến */
export const MAX_HOTELS_PER_PICK = 4;
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
 * Khối "Gợi ý dành cho bạn" trên trang chủ:
 * Gom theo điểm đến (Destination), mỗi điểm đến trả về danh sách khách sạn có giá/deal hời
 * (deal tốt nhất đứng đầu) kèm số lượng deal còn lại để giao diện hiển thị ghi chú.
 */
export function pickHomeRecommendations(
  candidates: readonly HomeCandidate[],
  recentPlaceIds: readonly string[],
  limit: number,
): HomeDestinationPick[] {
  // 1. Tính toán giá trung vị theo hạng sao để lọc ra các deal hời
  const tiers = new Map<number, number[]>();
  for (const h of candidates) {
    if (h.stars !== null) tiers.set(h.stars, [...(tiers.get(h.stars) ?? []), h.priceFrom]);
  }

  interface DealCandidate {
    hotel: HomeCandidate;
    percent: number;
  }

  const allDeals: DealCandidate[] = candidates
    .flatMap((h) => {
      const prices = h.stars === null ? undefined : tiers.get(h.stars);
      if (!prices || prices.length < MIN_TIER_SIZE) return [];
      const percent = Math.round((1 - h.priceFrom / median(prices)) * 100);
      return percent >= MIN_DEAL_PERCENT ? [{ hotel: h, percent }] : [];
    })
    .sort((a, b) => b.percent - a.percent || byValue(a.hotel, b.hotel));

  // Nhóm các deal theo province.slug
  const dealsByProvince = new Map<string, DealCandidate[]>();
  for (const d of allDeals) {
    const slug = d.hotel.province.slug;
    const list = dealsByProvince.get(slug) ?? [];
    list.push(d);
    dealsByProvince.set(slug, list);
  }

  const picks: HomeDestinationPick[] = [];
  const usedSlugs = new Set<string>();
  const usedBrands = new Set<string>();

  // 2. Nhóm ưu tiên 1: Nơi người dùng vừa tìm kiếm
  const recentPlaces = [...new Set(recentPlaceIds)].flatMap((id) => {
    const place = PLACES.find((p) => p.id === id);
    const slugs = resolvePlaceSlugs(id);
    return place && slugs ? [{ name: place.name, slugs }] : [];
  });

  for (const place of recentPlaces.slice(0, MAX_RECENT_PLACES)) {
    const inPlace = candidates.filter((h) => place.slugs.includes(h.province.slug)).sort(byValue);
    for (const h of inPlace) {
      const slug = h.province.slug;
      if (usedSlugs.has(slug)) continue;

      const provinceObj = h.province;
      const provinceDeals = dealsByProvince.get(slug) ?? [];
      const totalDealsCount = provinceDeals.length;

      const hotels: HomeStayPick[] = [];
      const usedHotels = new Set<string>();

      // Đưa tối đa 2 khách sạn trong inPlace cùng tỉnh này vào
      const sameProvinceCandidates = inPlace.filter((cand) => cand.province.slug === slug);
      for (const cand of sameProvinceCandidates.slice(0, 2)) {
        hotels.push({
          hotelId: cand.hotelId,
          name: cand.name,
          thumbnail: cand.thumbnail,
          stars: cand.stars,
          brand: cand.brand,
          priceFrom: cand.priceFrom,
          reason: { code: 'recent_place', text: `Vì bạn vừa tìm ${place.name}` },
        });
        usedHotels.add(cand.hotelId);
        if (cand.brand) usedBrands.add(cand.brand);
      }

      // Thêm các deal khác cùng tỉnh nếu còn chỗ trong mảng hotels
      for (const d of provinceDeals) {
        if (hotels.length >= MAX_HOTELS_PER_PICK) break;
        if (usedHotels.has(d.hotel.hotelId)) continue;
        hotels.push({
          hotelId: d.hotel.hotelId,
          name: d.hotel.name,
          thumbnail: d.hotel.thumbnail,
          stars: d.hotel.stars,
          brand: d.hotel.brand,
          priceFrom: d.hotel.priceFrom,
          reason: {
            code: 'good_deal',
            text: `Rẻ hơn ${d.percent}% so với giá trung bình khách sạn ${d.hotel.stars} sao`,
          },
        });
        usedHotels.add(d.hotel.hotelId);
      }

      usedSlugs.add(slug);
      picks.push({
        province: provinceObj,
        hotels,
        totalDealsCount,
        otherDealsCount: Math.max(0, totalDealsCount - 1),
      });

      if (picks.length >= limit) break;
    }
    if (picks.length >= limit) break;
  }

  // 3. Nhóm ưu tiên 2: Các tỉnh có deal giá tốt cao nhất
  for (const { hotel, percent } of allDeals) {
    if (picks.length >= limit) break;
    const slug = hotel.province.slug;
    if (usedSlugs.has(slug)) continue;
    if (hotel.brand && usedBrands.has(hotel.brand)) continue;

    const provinceDeals = dealsByProvince.get(slug) ?? [];
    const totalDealsCount = provinceDeals.length;

    const hotels: HomeStayPick[] = [];
    const usedHotels = new Set<string>();

    // Khách sạn đầu tiên có deal tốt nhất
    hotels.push({
      hotelId: hotel.hotelId,
      name: hotel.name,
      thumbnail: hotel.thumbnail,
      stars: hotel.stars,
      brand: hotel.brand,
      priceFrom: hotel.priceFrom,
      reason: {
        code: 'good_deal',
        text: `Rẻ hơn ${percent}% so với giá trung bình khách sạn ${hotel.stars} sao`,
      },
    });
    usedHotels.add(hotel.hotelId);
    if (hotel.brand) usedBrands.add(hotel.brand);

    // Thêm các deal khác trong cùng tỉnh
    for (const d of provinceDeals) {
      if (hotels.length >= MAX_HOTELS_PER_PICK) break;
      if (usedHotels.has(d.hotel.hotelId)) continue;
      hotels.push({
        hotelId: d.hotel.hotelId,
        name: d.hotel.name,
        thumbnail: d.hotel.thumbnail,
        stars: d.hotel.stars,
        brand: d.hotel.brand,
        priceFrom: d.hotel.priceFrom,
        reason: {
          code: 'good_deal',
          text: `Rẻ hơn ${d.percent}% so với giá trung bình khách sạn ${d.hotel.stars} sao`,
        },
      });
      usedHotels.add(d.hotel.hotelId);
    }

    usedSlugs.add(slug);
    picks.push({
      province: hotel.province,
      hotels,
      totalDealsCount,
      otherDealsCount: Math.max(0, totalDealsCount - 1),
    });
  }

  return picks.slice(0, limit);
}
