import { AIRPORTS } from './airports.js';
import { normalizeText } from './normalize-text.js';
import { PLACES, type PlaceSeed } from './places.js';

export type SuggestType = 'place' | 'hotel' | 'airport';
export const SUGGEST_TYPES: readonly SuggestType[] = ['place', 'hotel', 'airport'];

/** Một dòng trong chỉ mục gợi ý. */
export interface SuggestEntity {
  /** `<type>:<refId>`, duy nhất trong chỉ mục. */
  id: string;
  type: SuggestType;
  /** Mã để bước sau dùng: slug địa điểm (placeId của /stays), mã khách sạn của commerce, mã IATA. */
  refId: string;
  name: string;
  subtitle: string | null;
  /** Địa điểm chứa nó, để /stays lọc theo nhánh cây. */
  placeId: string | null;
  searchText: string;
  popularity: number;
}

/** Phần danh mục khách sạn mà gợi ý cần. Khớp kiểu CatalogHotel của commerce. */
export interface HotelSummary {
  id: string;
  name: string;
  province: { slug: string; name: string };
  stars: number | null;
}

const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));

function describePlace(place: PlaceSeed): string | null {
  return place.parentId ? (PLACE_BY_ID.get(place.parentId)?.name ?? null) : null;
}

function placeLabel(placeId: string, fallback: string): string {
  const place = PLACE_BY_ID.get(placeId);
  if (!place) return fallback;
  const parent = describePlace(place);
  return parent ? `${place.name}, ${parent}` : place.name;
}

/** Dựng toàn bộ chỉ mục gợi ý từ cây địa điểm, sân bay và danh mục khách sạn. Hàm thuần. */
export function buildSuggestEntities(hotels: readonly HotelSummary[]): SuggestEntity[] {
  const hotelCountByPlace = new Map<string, number>();
  for (const hotel of hotels) {
    const slug = hotel.province.slug;
    hotelCountByPlace.set(slug, (hotelCountByPlace.get(slug) ?? 0) + 1);
    const parentId = PLACE_BY_ID.get(slug)?.parentId;
    if (parentId) hotelCountByPlace.set(parentId, (hotelCountByPlace.get(parentId) ?? 0) + 1);
  }

  const places: SuggestEntity[] = PLACES.map((place) => ({
    id: `place:${place.id}`,
    type: 'place',
    refId: place.id,
    name: place.name,
    subtitle: describePlace(place),
    placeId: place.id,
    searchText: normalizeText([place.name, ...place.aliases].join(' ')),
    popularity: hotelCountByPlace.get(place.id) ?? 0,
  }));

  const airports: SuggestEntity[] = AIRPORTS.map((airport) => {
    const label = placeLabel(airport.placeId, '');
    // Gõ "hcm" cũng ra Tân Sơn Nhất: lấy cả tên gọi khác của nơi có sân bay.
    const placeAliases = PLACE_BY_ID.get(airport.placeId)?.aliases ?? [];
    return {
      id: `airport:${airport.code}`,
      type: 'airport',
      refId: airport.code,
      name: airport.name,
      subtitle: `${airport.code} · ${label}`,
      placeId: airport.placeId,
      searchText: normalizeText([airport.code, airport.name, label, ...placeAliases].join(' ')),
      popularity: hotelCountByPlace.get(airport.placeId) ?? 0,
    };
  });

  const hotelEntities: SuggestEntity[] = hotels.map((hotel) => ({
    id: `hotel:${hotel.id}`,
    type: 'hotel',
    refId: hotel.id,
    name: hotel.name,
    subtitle: placeLabel(hotel.province.slug, hotel.province.name),
    placeId: hotel.province.slug,
    searchText: normalizeText(hotel.name),
    popularity: hotel.stars ?? 0,
  }));

  return [...places, ...airports, ...hotelEntities];
}

/** Hạn mức mỗi loại trong một danh sách gợi ý (tài liệu Search §2.3: ~3 địa điểm, 4 khách sạn, 1 sân bay). */
export const SUGGEST_QUOTA: Readonly<Record<SuggestType, number>> = { place: 3, hotel: 4, airport: 1 };
export const SUGGEST_LIMIT = 8;

/**
 * Chọn tối đa `limit` dòng từ danh sách đã xếp hạng: mỗi loại tới hạn mức trước, còn chỗ thì lấy thêm theo thứ hạng.
 * Giữ nguyên thứ hạng ban đầu, nên gõ đúng tên khách sạn thì khách sạn vẫn đứng đầu.
 */
export function pickSuggestions<T extends { type: SuggestType }>(
  ranked: readonly T[],
  limit = SUGGEST_LIMIT,
  quota: Readonly<Record<SuggestType, number>> = SUGGEST_QUOTA,
): T[] {
  const taken = new Set<number>();
  const used: Record<SuggestType, number> = { place: 0, hotel: 0, airport: 0 };
  ranked.forEach((candidate, index) => {
    if (taken.size < limit && used[candidate.type] < quota[candidate.type]) {
      taken.add(index);
      used[candidate.type] += 1;
    }
  });
  ranked.forEach((_, index) => {
    if (taken.size < limit) taken.add(index);
  });
  return ranked.filter((_, index) => taken.has(index));
}
