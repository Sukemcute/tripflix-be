import { PLACES } from './places.js';

/** Một khách sạn còn phòng cho ngày đã chọn, giá thật từ commerce. */
export interface StayResult {
  hotelId: string;
  name: string;
  stars: number | null;
  thumbnail: string | null;
  province: { slug: string; name: string };
  /** Một đêm một phòng, gói giá mặc định. */
  unitPrice: number;
  /** Cả kỳ ở, mọi phòng. */
  totalPrice: number;
}

export type StaySort = 'price' | 'stars';
export const STAY_SORTS: readonly StaySort[] = ['price', 'stars'];

export interface StayFilter {
  minStars?: number;
  priceMin?: number;
  priceMax?: number;
}

/**
 * Các provinceSlug của commerce nằm trong một nơi: tỉnh gồm chính nó và các điểm đến con (Lâm Đồng → lam-dong, da-lat);
 * điểm đến chỉ là chính nó. Nơi không có trong cây thì null.
 */
export function resolvePlaceSlugs(placeId: string): string[] | null {
  const place = PLACES.find((p) => p.id === placeId);
  if (!place) return null;
  if (place.kind === 'destination') return [place.id];
  return [place.id, ...PLACES.filter((p) => p.parentId === place.id).map((p) => p.id)];
}

const byPrice = (a: StayResult, b: StayResult) => a.unitPrice - b.unitPrice || a.name.localeCompare(b.name, 'vi');
const byStars = (a: StayResult, b: StayResult) => (b.stars ?? 0) - (a.stars ?? 0) || byPrice(a, b);

/** Lọc theo hạng sao tối thiểu và khoảng giá một đêm, rồi sắp xếp. Không đổi mảng gốc. */
export function filterAndSortStays(stays: readonly StayResult[], filter: StayFilter, sort: StaySort): StayResult[] {
  return stays
    .filter(
      (s) =>
        (filter.minStars === undefined || (s.stars ?? 0) >= filter.minStars) &&
        (filter.priceMin === undefined || s.unitPrice >= filter.priceMin) &&
        (filter.priceMax === undefined || s.unitPrice <= filter.priceMax),
    )
    .sort(sort === 'stars' ? byStars : byPrice);
}

/**
 * Cắt trang theo vị trí. Con trỏ là vị trí bắt đầu dạng chuỗi.
 * ponytail: phân trang theo offset trên danh sách tính lại mỗi request; đủ cho vài trăm khách sạn một nơi.
 */
export function paginate<T>(items: readonly T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const start = cursor ? Number(cursor) : 0;
  const end = start + limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}
