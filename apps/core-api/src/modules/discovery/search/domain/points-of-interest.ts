import { normalizeText } from './normalize-text.js';

/**
 * Điểm tham quan, ăn uống, chỗ ở có toạ độ cho trợ lý Tripi xếp lộ trình (TF31, plan B1).
 * Lưu ở bảng discovery.points_of_interest; file points-of-interest.data.ts (sinh từ OpenStreetMap) là nguồn nạp lúc worker khởi động.
 */
export type PoiKind = 'see' | 'food' | 'cafe' | 'lodging';
export const POI_KINDS: readonly PoiKind[] = ['see', 'food', 'cafe', 'lodging'];
export const POI_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

export interface PointOfInterestSeed {
  id: string;
  name: string;
  kind: PoiKind;
  lat: number;
  lng: number;
  /** id nơi trong discovery.places (cột place_id). */
  cityId: string;
  tags: string[];
  popularity: number;
}

export interface PoiQuery {
  city?: string;
  near?: { lat: number; lng: number };
  kinds?: PoiKind[];
  radiusKm: number;
  limit: number;
}

export interface PoiResult extends Omit<PointOfInterestSeed, 'cityId'> {
  city: string;
}

const EARTH_KM = 6371;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Nút của cây nơi mà /api/places cần (bảng discovery.places). */
export interface PoiPlace {
  id: string;
  name: string;
  parentId: string | null;
  aliases: readonly string[];
  lat: number | null;
  lng: number | null;
}

/** Nơi khớp theo id, tên hoặc bí danh, không phân biệt dấu ("Vũng Tàu", "vung-tau", "TP.HCM", "Sài Gòn"). */
function findPlace(name: string, places: readonly PoiPlace[]): PoiPlace | undefined {
  const wanted = normalizeText(name); // "vung-tau" và "TP.HCM" thành "vung tau", "tp hcm"
  return places.find((p) => [p.id, p.name, ...p.aliases].some((n) => normalizeText(n) === wanted));
}

/** Nơi và các nơi con trực tiếp (tỉnh → điểm đến; cây v1 chỉ có hai tầng). */
const subtree = (id: string, places: readonly PoiPlace[]) => new Set([id, ...places.filter((p) => p.parentId === id).map((p) => p.id)]);

/**
 * Lọc theo nơi (gồm nơi con: "Lâm Đồng" ra điểm của Đà Lạt) hoặc toạ độ, loại và bán kính; xếp theo độ phổ biến rồi khoảng cách.
 * Nơi không có toạ độ (tỉnh) thì không lọc bán kính. Điểm đến chưa có điểm riêng (Sài Gòn dưới TP.HCM) thì dùng điểm của tỉnh cha.
 */
export function findPointsOfInterest(query: PoiQuery, points: readonly PointOfInterestSeed[], places: readonly PoiPlace[]): PoiResult[] {
  const place = query.city ? findPlace(query.city, places) : undefined;
  if (query.city && !place) return [];
  const parent = place?.parentId ? places.find((p) => p.id === place.parentId) : undefined;
  let ids = place ? subtree(place.id, places) : null;
  if (ids && parent && !points.some((p) => ids!.has(p.cityId))) ids = subtree(parent.id, places);
  const at = (p?: PoiPlace) => (p?.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : undefined);
  const centre = query.near ?? at(place) ?? (place && !at(place) && parent ? at(parent) : undefined);
  if (!centre && !place) return [];
  const kinds = new Set(query.kinds?.length ? query.kinds : POI_KINDS);
  const nameOf = new Map(places.map((p) => [p.id, p.name]));
  return points
    .filter((p) => kinds.has(p.kind) && (!ids || ids.has(p.cityId)))
    .map((p) => ({ point: p, km: centre ? distanceKm(centre, p) : 0 }))
    .filter(({ km }) => km <= query.radiusKm)
    .sort((a, b) => b.point.popularity - a.point.popularity || a.km - b.km)
    .slice(0, query.limit)
    .map(({ point: { cityId, ...rest } }) => ({ ...rest, city: nameOf.get(cityId) ?? '' }));
}
