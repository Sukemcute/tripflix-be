import { POI_CITIES, POINTS_OF_INTEREST } from './points-of-interest.data.js';
import { normalizeText } from './normalize-text.js';

/**
 * Điểm tham quan, ăn uống, chỗ ở có toạ độ cho trợ lý Tripi xếp lộ trình (TF31, plan B1).
 * Dữ liệu tĩnh sinh từ OpenStreetMap như PLACES, AIRPORTS: đọc trong bộ nhớ, không cần bảng.
 * shortcut: vài trăm điểm cho 7 thành phố demo, chưa có bảng; khi cần sửa trên admin hoặc thêm nhiều nơi thì chuyển sang bảng.
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

// Tên người dùng hay gọi khác tên chuẩn (đã bỏ dấu, viết thường).
const CITY_ALIASES: Record<string, string> = {
  'tp hcm': 'ho-chi-minh',
  tphcm: 'ho-chi-minh',
  hcm: 'ho-chi-minh',
  'sai gon': 'ho-chi-minh',
  'tp ho chi minh': 'ho-chi-minh',
  hn: 'ha-noi',
};

/** Thành phố khớp theo tên không dấu, id hoặc tên gọi khác ("Vũng Tàu", "vung-tau", "TP.HCM", "Sài Gòn"). */
function findCity(name: string) {
  const wanted = normalizeText(name); // "vung-tau" và "TP.HCM" thành "vung tau", "tp hcm"
  const id = CITY_ALIASES[wanted];
  return POI_CITIES.find((c) => c.id === id || normalizeText(c.name) === wanted || normalizeText(c.id) === wanted);
}

/** Lọc theo thành phố hoặc toạ độ, loại và bán kính; xếp theo độ phổ biến rồi khoảng cách. */
export function findPointsOfInterest(query: PoiQuery, points: readonly PointOfInterestSeed[] = POINTS_OF_INTEREST): PoiResult[] {
  const city = query.city ? findCity(query.city) : undefined;
  if (query.city && !city) return [];
  const centre = query.near ?? (city ? { lat: city.lat, lng: city.lng } : undefined);
  if (!centre) return [];
  const kinds = new Set(query.kinds?.length ? query.kinds : POI_KINDS);
  return points
    .filter((p) => kinds.has(p.kind) && (!city || p.cityId === city.id))
    .map((p) => ({ point: p, km: distanceKm(centre, p) }))
    .filter(({ km }) => km <= query.radiusKm)
    .sort((a, b) => b.point.popularity - a.point.popularity || a.km - b.km)
    .slice(0, query.limit)
    .map(({ point: { cityId, ...rest } }) => ({ ...rest, city: POI_CITIES.find((c) => c.id === cityId)?.name ?? '' }));
}
