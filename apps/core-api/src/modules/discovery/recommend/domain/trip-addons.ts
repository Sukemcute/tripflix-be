// F10 (TF39): gợi ý phần còn thiếu của chuyến. Hàm thuần: chọn loại cần gợi ý, ngày, sân bay đi.
import { AIRPORTS } from '../../search/domain/airports.js';
import { PLACES } from '../../search/domain/places.js';
import { resolvePlaceSlugs } from '../../search/domain/stays.js';

/** Một mục người dùng đang chọn (chưa giữ chỗ). */
export type TripItem =
  | { type: 'hotel'; hotelId: string; checkIn: string; checkOut: string }
  | { type: 'flight'; fromAirport: string; toAirport: string; date: string };

export type AddonPlan =
  /**
   * Có phòng, chưa có vé: chiều đi tới khách sạn nhận phòng sớm nhất, ngày nhận phòng; chiều về từ khách sạn trả phòng
   * muộn nhất, ngày trả phòng (Đà Lạt rồi Nha Trang: về từ Nha Trang).
   */
  | { missing: 'flight'; hotelId: string; returnHotelId: string; departDate: string; returnDate: string }
  /** Có vé, chưa có phòng: ở nơi đến của chiều đi, tới chiều về (vé một chiều: DEFAULT_STAY_NIGHTS đêm). */
  | { missing: 'hotel'; toAirport: string; checkIn: string; checkOut: string }
  /** Đủ cả hai, hoặc chưa chọn gì: không gợi ý. */
  | { missing: null };

export const DEFAULT_STAY_NIGHTS = 2;

/** Ngày YYYY-MM-DD cộng n ngày (UTC, không lệch múi giờ). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function planTripAddons(items: readonly TripItem[]): AddonPlan {
  const hotels = items.filter((i): i is Extract<TripItem, { type: 'hotel' }> => i.type === 'hotel');
  const flights = items.filter((i): i is Extract<TripItem, { type: 'flight' }> => i.type === 'flight');
  if (hotels.length > 0 === flights.length > 0) return { missing: null };

  if (hotels.length > 0) {
    const first = [...hotels].sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]!;
    const last = [...hotels].sort((a, b) => b.checkOut.localeCompare(a.checkOut))[0]!;
    return { missing: 'flight', hotelId: first.hotelId, returnHotelId: last.hotelId, departDate: first.checkIn, returnDate: last.checkOut };
  }

  const sorted = [...flights].sort((a, b) => a.date.localeCompare(b.date));
  const outbound = sorted[0]!;
  // Chiều về: chuyến sớm nhất cất cánh từ nơi đến, sau ngày đi.
  const back = sorted.find((f) => f.fromAirport === outbound.toAirport && f.date > outbound.date);
  return { missing: 'hotel', toAirport: outbound.toAirport, checkIn: outbound.date, checkOut: back?.date ?? addDays(outbound.date, DEFAULT_STAY_NIGHTS) };
}

/** Tỉnh chứa nơi này: điểm đến thì lấy tỉnh cha (Nha Trang → Khánh Hòa); tỉnh hoặc nơi lạ thì chính nó. */
export function provinceOf(placeSlug: string): string {
  const place = PLACES.find((p) => p.id === placeSlug);
  return place?.kind === 'destination' && place.parentId ? place.parentId : placeSlug;
}

/** Mọi nơi trong cùng tỉnh (tỉnh và các điểm đến con). Nơi lạ chỉ có chính nó. */
export function provinceGroupOf(placeSlug: string): string[] {
  const root = provinceOf(placeSlug);
  return resolvePlaceSlugs(root) ?? [root];
}

/** Chuyến bay rút gọn để ghép nơi với sân bay: commerce ghi mỗi chuyến phục vụ nơi nào (destinationSlug). */
export interface AirportServes {
  toAirport: string;
  placeSlug: string;
}

/**
 * Sân bay đến cho khách sạn ở placeSlug, theo dữ liệu chuyến bay: sân bay phục vụ đúng nơi đó (Côn Đảo → VCS),
 * không có thì của tỉnh cha, không có nữa thì của các nơi cùng tỉnh trừ điểm đến đã có sân bay riêng
 * (Vũng Tàu → SGN, không phải VCS của Côn Đảo). Rỗng: nơi không có sân bay gần trong dữ liệu (Lào Cai, Ninh Bình).
 */
export function airportsForPlace(placeSlug: string, flights: readonly AirportServes[]): string[] {
  const airportsOf = (slugs: ReadonlySet<string>) => [...new Set(flights.filter((f) => slugs.has(f.placeSlug)).map((f) => f.toAirport))].sort();
  const exact = airportsOf(new Set([placeSlug]));
  if (exact.length) return exact;
  const parent = airportsOf(new Set([provinceOf(placeSlug)]));
  if (parent.length) return parent;
  // Sân bay gắn riêng với một điểm đến khác (VCS của Côn Đảo, PQC của Phú Quốc) không phục vụ nơi này.
  const isDedicatedElsewhere = (code: string) => {
    const home = AIRPORTS.find((a) => a.code === code)?.placeId;
    return home !== undefined && home !== placeSlug && PLACES.find((p) => p.id === home)?.kind === 'destination';
  };
  return airportsOf(new Set(provinceGroupOf(placeSlug))).filter((code) => !isDedicatedElsewhere(code));
}

/** Các nơi mà sân bay phục vụ (CXR → khanh-hoa, nha-trang; VCS → con-dao), theo dữ liệu chuyến bay. */
export function placesServedBy(airport: string, flights: readonly AirportServes[]): string[] {
  return [...new Set(flights.filter((f) => f.toAirport === airport).map((f) => f.placeSlug))].sort();
}

/** Sân bay đi mặc định: theo thứ tự này, cái đầu tiên có chuyến; không có thì sân bay đầu theo ABC. */
export const PREFERRED_ORIGINS = ['SGN', 'HAN'] as const;

export function pickOrigin(origins: readonly string[], requested?: string | null): string | null {
  if (requested && origins.includes(requested)) return requested;
  return PREFERRED_ORIGINS.find((code) => origins.includes(code)) ?? [...origins].sort()[0] ?? null;
}

/** Một chuyến đặt được trong ngày, giá thật cho số khách. productId + ratePlanCode gửi thẳng vào POST /checkout. */
export interface FlightQuote {
  flightKey: string;
  /** Hạng ghế rẻ nhất còn chỗ. */
  productId: string;
  ratePlanCode: string;
  name: string;
  airline: string | null;
  fromAirport: string;
  toAirport: string;
  date: string;
  departTime: string | null;
  arriveTime: string | null;
  /** Một vé người lớn. */
  unitPrice: number;
  /** Mọi vé người lớn. */
  totalPrice: number;
}
