/**
 * Gợi ý vé bay và chỗ ở khi khách tự lên lộ trình (TF105, tab Đặt của app).
 * Hàm thuần: nhận lựa chọn còn bán với giá thật, trả thứ tự gợi ý và câu lý do hiện dưới mỗi lựa chọn.
 * Chủ của luật xếp hạng: discovery (Duy). Đổi cách xếp, thêm lý do ở đây; hợp đồng API không đổi.
 */

export type FlightSort = 'cheapest' | 'best_time';
export const FLIGHT_SORTS: readonly FlightSort[] = ['cheapest', 'best_time'];

export type StaySuggestSort = 'best_price' | 'top_rated';
export const STAY_SUGGEST_SORTS: readonly StaySuggestSort[] = ['best_price', 'top_rated'];

/** Chiều đi tới nơi, hay chiều về nhà: lý do "giờ đẹp" khác nhau. */
export type FlightLeg = 'outbound' | 'inbound';

/** Một lý do ngắn hiện dưới lựa chọn, `code` để app đổi màu hoặc biểu tượng nếu cần. */
export interface SuggestReason {
  code: 'cheapest' | 'arrive_before_check_in' | 'full_last_morning' | 'best_price' | 'top_rated';
  text: string;
}

export interface FlightCandidate {
  flightId: string;
  /** Hạng ghế rẻ nhất còn bán: mã dùng để đặt. */
  productId: string;
  ratePlanCode: string;
  name: string;
  airline: string | null;
  fromAirport: string;
  toAirport: string;
  /** HH:mm theo giờ Việt Nam; null khi nguồn không có. */
  departTime: string | null;
  arriveTime: string | null;
  /** Một vé. */
  unitPrice: number;
  /** Mọi vé cho số khách đã chọn. */
  totalPrice: number;
}

export interface FlightSuggestion extends FlightCandidate {
  reason: SuggestReason | null;
}

export interface StayCandidate {
  hotelId: string;
  slug: string | null;
  name: string;
  stars: number | null;
  thumbnail: string | null;
  rating: { average: number; count: number } | null;
  /** Loại phòng và gói giá rẻ nhất còn bán: mã dùng để đặt. */
  roomProductId: string;
  ratePlanCode: string;
  /** Một đêm một phòng. */
  unitPrice: number;
  /** Cả kỳ ở, mọi phòng. */
  totalPrice: number;
}

export interface StaySuggestion extends StayCandidate {
  reason: SuggestReason | null;
}

/** Giờ nhận phòng phổ biến: chuyến tới trước giờ này thì kịp nhận phòng trong ngày. */
const CHECK_IN_TIME = '14:00';
/** Chuyến về từ giờ này trở đi thì còn trọn buổi sáng ngày cuối. */
const LAST_MORNING_END = '12:00';
/** Chuyến quá sớm (trước giờ này) không tính là giờ đẹp dù tới sớm. */
const EARLIEST_COMFORT_DEPART = '06:00';

export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')}đ`;
}

function flightTimeReason(flight: FlightCandidate, leg: FlightLeg): SuggestReason | null {
  if (leg === 'outbound') {
    const isComfortable = !flight.departTime || flight.departTime >= EARLIEST_COMFORT_DEPART;
    if (flight.arriveTime && flight.arriveTime <= CHECK_IN_TIME && isComfortable) {
      return { code: 'arrive_before_check_in', text: `Tới ${flight.arriveTime}, kịp nhận phòng` };
    }
    return null;
  }
  if (flight.departTime && flight.departTime >= LAST_MORNING_END) {
    return { code: 'full_last_morning', text: `Bay ${flight.departTime}, trọn buổi sáng cuối` };
  }
  return null;
}

/**
 * Xếp chuyến bay của một chiều.
 * - `cheapest`: rẻ trước, bằng giá thì bay sớm trước; chuyến rẻ nhất có lý do "Rẻ nhất".
 * - `best_time`: chuyến có giờ đẹp (chiều đi tới kịp nhận phòng, chiều về còn trọn buổi sáng) lên trước, rồi rẻ trước.
 */
export function rankFlights(flights: readonly FlightCandidate[], leg: FlightLeg, sort: FlightSort): FlightSuggestion[] {
  const byPrice = (a: FlightCandidate, b: FlightCandidate) =>
    a.totalPrice - b.totalPrice || (a.departTime ?? '').localeCompare(b.departTime ?? '');
  const withReason = flights.map((flight) => ({ ...flight, timeReason: flightTimeReason(flight, leg) }));
  if (sort === 'best_time') {
    return withReason
      .sort((a, b) => Number(!a.timeReason) - Number(!b.timeReason) || byPrice(a, b))
      .map(({ timeReason, ...flight }) => ({ ...flight, reason: timeReason }));
  }
  const sorted = withReason.sort(byPrice);
  const cheapest = sorted[0]?.totalPrice;
  return sorted.map(({ timeReason, ...flight }) => ({
    ...flight,
    reason:
      flight.totalPrice === cheapest
        ? { code: 'cheapest', text: `Rẻ nhất · ${formatVnd(flight.unitPrice)}/người` }
        : timeReason,
  }));
}

/**
 * Xếp chỗ ở.
 * - `best_price`: rẻ một đêm trước; lý do là giá một đêm.
 * - `top_rated`: điểm đánh giá cao trước (bằng điểm thì nhiều đánh giá hơn), chỗ chưa có đánh giá xuống cuối.
 */
export function rankStays(stays: readonly StayCandidate[], sort: StaySuggestSort): StaySuggestion[] {
  if (sort === 'top_rated') {
    return [...stays]
      .sort(
        (a, b) =>
          (b.rating?.average ?? -1) - (a.rating?.average ?? -1) ||
          (b.rating?.count ?? 0) - (a.rating?.count ?? 0) ||
          a.unitPrice - b.unitPrice,
      )
      .map((stay) => ({
        ...stay,
        reason: stay.rating
          ? {
              code: 'top_rated',
              text: `${stay.rating.average.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}/5 · ${stay.rating.count} đánh giá`,
            }
          : null,
      }));
  }
  return [...stays]
    .sort((a, b) => a.unitPrice - b.unitPrice || a.name.localeCompare(b.name, 'vi'))
    .map((stay) => ({ ...stay, reason: { code: 'best_price', text: `${formatVnd(stay.unitPrice)}/đêm` } }));
}
