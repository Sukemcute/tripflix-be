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

/**
 * Các điểm đến du lịch trọng điểm hàng đầu Việt Nam được ưu tiên giới thiệu:
 * Đà Lạt, Nha Trang, Phú Quốc, Đà Nẵng, Hội An, Hạ Long, Quy Nhơn, Ninh Bình, Sa Pa (Lào Cai).
 */
export const DEFAULT_TOURIST_DESTINATIONS = [
  'da-lat',
  'nha-trang',
  'phu-quoc',
  'da-nang',
  'hoi-an',
  'ha-long',
  'quy-nhon',
  'ninh-binh',
  'lao-cai',
] as const;

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
 *
 * Thứ tự ưu tiên:
 * 1. Nơi người dùng vừa tìm kiếm (recentPlaceIds)
 * 2. Điểm đến du lịch trọng điểm có deal hời (Đà Lạt, Nha Trang, Phú Quốc, Hội An, Đà Nẵng, Hạ Long...)
 * 3. Các tỉnh thành khác có deal giá tốt cao nhất (allDeals)
 */
export function pickHomeRecommendations(
  candidates: readonly HomeCandidate[],
  recentPlaceIds: readonly string[],
  limit: number,
): HomeDestinationPick[] {
  // 1. Tính toán giá trung vị theo hạng sao (cả toàn quốc và theo từng điểm đến nếu đủ mẫu)
  const nationalTiers = new Map<number, number[]>();
  const provinceTiers = new Map<string, Map<number, number[]>>();

  for (const h of candidates) {
    if (h.stars !== null) {
      nationalTiers.set(h.stars, [...(nationalTiers.get(h.stars) ?? []), h.priceFrom]);

      let pMap = provinceTiers.get(h.province.slug);
      if (!pMap) {
        pMap = new Map();
        provinceTiers.set(h.province.slug, pMap);
      }
      pMap.set(h.stars, [...(pMap.get(h.stars) ?? []), h.priceFrom]);
    }
  }

  interface DealCandidate {
    hotel: HomeCandidate;
    percent: number;
    scopeText: string;
  }

  const allDeals: DealCandidate[] = candidates
    .flatMap((h) => {
      if (h.stars === null) return [];

      // Ưu tiên so sánh với giá trung vị của chính điểm đến nếu có từ 3 khách sạn cùng hạng sao (ví dụ Phú Quốc, Nha Trang)
      const pPrices = provinceTiers.get(h.province.slug)?.get(h.stars);
      if (pPrices && pPrices.length >= MIN_TIER_SIZE) {
        const pMedian = median(pPrices);
        const percent = Math.round((1 - h.priceFrom / pMedian) * 100);
        if (percent >= MIN_DEAL_PERCENT) {
          return [{
            hotel: h,
            percent,
            scopeText: `tại ${h.province.name}`,
          }];
        }
      }

      // So sánh với trung vị toàn quốc nếu đủ mẫu
      const nPrices = nationalTiers.get(h.stars);
      if (nPrices && nPrices.length >= MIN_TIER_SIZE) {
        const nMedian = median(nPrices);
        const percent = Math.round((1 - h.priceFrom / nMedian) * 100);
        if (percent >= MIN_DEAL_PERCENT) {
          return [{
            hotel: h,
            percent,
            scopeText: '',
          }];
        }
      }

      return [];
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
            text: `Rẻ hơn ${d.percent}% so với giá trung bình khách sạn ${d.hotel.stars} sao${d.scopeText ? ` ${d.scopeText}` : ''}`,
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

  // 3. Nhóm ưu tiên 2: Các điểm đến du lịch trọng điểm có deal hoặc phòng tốt
  for (const slug of DEFAULT_TOURIST_DESTINATIONS) {
    if (picks.length >= limit) break;
    if (usedSlugs.has(slug)) continue;

    const inPlace = candidates.filter((h) => h.province.slug === slug).sort(byValue);
    if (inPlace.length === 0) continue;

    const provinceObj = inPlace[0]!.province;
    const provinceDeals = dealsByProvince.get(slug) ?? [];
    const totalDealsCount = provinceDeals.length;

    // Chỉ đưa điểm đến du lịch vào nếu có ít nhất 1 khách sạn đạt chuẩn giá tốt (deal hời)
    if (provinceDeals.length === 0) continue;

    const hotels: HomeStayPick[] = [];
    const usedHotels = new Set<string>();

    if (provinceDeals.length > 0) {
      const topDeal = provinceDeals[0]!;
      hotels.push({
        hotelId: topDeal.hotel.hotelId,
        name: topDeal.hotel.name,
        thumbnail: topDeal.hotel.thumbnail,
        stars: topDeal.hotel.stars,
        brand: topDeal.hotel.brand,
        priceFrom: topDeal.hotel.priceFrom,
        reason: {
          code: 'good_deal',
          text: `Rẻ hơn ${topDeal.percent}% so với giá trung bình khách sạn ${topDeal.hotel.stars} sao${topDeal.scopeText ? ` ${topDeal.scopeText}` : ''}`,
        },
      });
      usedHotels.add(topDeal.hotel.hotelId);
      if (topDeal.hotel.brand) usedBrands.add(topDeal.hotel.brand);
    } else {
      const topHotel = inPlace[0]!;
      hotels.push({
        hotelId: topHotel.hotelId,
        name: topHotel.name,
        thumbnail: topHotel.thumbnail,
        stars: topHotel.stars,
        brand: topHotel.brand,
        priceFrom: topHotel.priceFrom,
        reason: {
          code: 'good_deal',
          text: `Giá ưu đãi tốt nhất tại ${provinceObj.name}`,
        },
      });
      usedHotels.add(topHotel.hotelId);
      if (topHotel.brand) usedBrands.add(topHotel.brand);
    }

    // Thêm các deal / khách sạn khác cùng tỉnh
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
          text: `Rẻ hơn ${d.percent}% so với giá trung bình khách sạn ${d.hotel.stars} sao${d.scopeText ? ` ${d.scopeText}` : ''}`,
        },
      });
      usedHotels.add(d.hotel.hotelId);
    }

    for (const h of inPlace) {
      if (hotels.length >= MAX_HOTELS_PER_PICK) break;
      if (usedHotels.has(h.hotelId)) continue;
      hotels.push({
        hotelId: h.hotelId,
        name: h.name,
        thumbnail: h.thumbnail,
        stars: h.stars,
        brand: h.brand,
        priceFrom: h.priceFrom,
        reason: {
          code: 'good_deal',
          text: `Giá ưu đãi tốt nhất tại ${provinceObj.name}`,
        },
      });
      usedHotels.add(h.hotelId);
    }

    usedSlugs.add(slug);
    picks.push({
      province: provinceObj,
      hotels,
      totalDealsCount: Math.max(totalDealsCount, hotels.length),
      otherDealsCount: Math.max(0, Math.max(totalDealsCount, hotels.length) - 1),
    });
  }

  // 4. Nhóm ưu tiên 3: Các tỉnh khác có deal giá tốt cao nhất
  for (const { hotel, percent, scopeText } of allDeals) {
    if (picks.length >= limit) break;
    const slug = hotel.province.slug;
    if (usedSlugs.has(slug)) continue;
    if (hotel.brand && usedBrands.has(hotel.brand)) continue;

    const provinceDeals = dealsByProvince.get(slug) ?? [];
    const totalDealsCount = provinceDeals.length;

    const hotels: HomeStayPick[] = [];
    const usedHotels = new Set<string>();

    hotels.push({
      hotelId: hotel.hotelId,
      name: hotel.name,
      thumbnail: hotel.thumbnail,
      stars: hotel.stars,
      brand: hotel.brand,
      priceFrom: hotel.priceFrom,
      reason: {
        code: 'good_deal',
        text: `Rẻ hơn ${percent}% so với giá trung bình khách sạn ${hotel.stars} sao${scopeText ? ` ${scopeText}` : ''}`,
      },
    });
    usedHotels.add(hotel.hotelId);
    if (hotel.brand) usedBrands.add(hotel.brand);

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
          text: `Rẻ hơn ${d.percent}% so với giá trung bình khách sạn ${d.hotel.stars} sao${d.scopeText ? ` ${d.scopeText}` : ''}`,
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
