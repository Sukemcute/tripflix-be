import type { FlightProfileFeatures } from '../builders/flight-profile.js';
import { buildGroups, formatVnd, type Badge, type Grouped } from '../trip-addon-groups.js';
import type { FlightQuote } from '../trip-addons.js';
import { budgetAnchor, budgetFit, pickBudget, type BudgetLevel, type BudgetParams } from './budget-fit.js';

/**
 * trip_flights@v0: xếp chuyến bay gợi ý thêm vào chuyến (F10, TF39) theo nhóm tiêu chí, trên hồ sơ của flight_profile@v0
 * và giá thật của ngày bay. Cùng cách tính độ hợp ngân sách với trip_stays@v0. Hàm thuần, tất định.
 */
export const TRIP_FLIGHTS_RANKER = 'trip_flights@v0';

export const FLIGHT_GROUPS = {
  cheapest: 'Rẻ nhất',
  good_time: 'Giờ đẹp',
  fastest: 'Bay nhanh',
  flexible: 'Có vé hoàn huỷ',
  popular: 'Được đặt nhiều',
} as const;
export type FlightGroupCode = keyof typeof FLIGHT_GROUPS;

/** Thứ tự chip theo ngân sách. */
export const FLIGHT_GROUP_ORDER: Record<BudgetLevel, readonly FlightGroupCode[]> = {
  saving: ['cheapest', 'good_time', 'popular', 'fastest', 'flexible'],
  moderate: ['cheapest', 'good_time', 'fastest', 'flexible', 'popular'],
  premium: ['good_time', 'fastest', 'flexible', 'popular', 'cheapest'],
};

export interface TripFlightsParams extends BudgetParams {
  /** Chiều đi "giờ đẹp": cất cánh từ giờ này và tới trước giờ nhận phòng. */
  earliestDeparture: string;
  checkInTime: string;
  /** Chiều về "giờ đẹp": cất cánh từ giờ này (sau giờ trả phòng). */
  returnAfter: string;
  /** Mỗi chiều trả ít nhất chừng này chuyến (nếu có), cộng các chuyến nằm trong nhóm. */
  minOptions: number;
}

export const DEFAULT_TRIP_FLIGHTS_PARAMS: TripFlightsParams = {
  budgetPercentile: { saving: 30, moderate: 60 },
  defaultBudget: 'moderate',
  tolerance: 1.3,
  steepness: 3,
  minFit: 0.5,
  earliestDeparture: '06:00',
  checkInTime: '14:00',
  returnAfter: '13:00',
  minOptions: 8,
};

export interface TripFlightCandidate extends FlightQuote {
  /** Hồ sơ flight_profile@v0; null khi chuyến chưa được dựng (mới thêm, job chưa chạy). */
  profile: FlightProfileFeatures | null;
}

export interface FlightPick extends FlightQuote {
  /** 0..1: 1 là trong ngân sách. */
  budgetFit: number;
  badges: Badge<FlightGroupCode>[];
}

export interface TripFlightsResult extends Grouped<FlightPick, FlightGroupCode> {
  budgetAnchor: number | null;
  budget: BudgetLevel;
}

export function rankTripFlights(
  input: { candidates: readonly TripFlightCandidate[]; leg: 'outbound' | 'inbound'; budgetLevels?: readonly BudgetLevel[] | null; perGroup: number },
  params: TripFlightsParams = DEFAULT_TRIP_FLIGHTS_PARAMS,
): TripFlightsResult {
  const budget = pickBudget(input.budgetLevels, params.defaultBudget);
  const anchor = budgetAnchor(
    input.candidates.map((c) => c.unitPrice),
    budget,
    params,
  );
  const picks = input.candidates.map(({ profile, ...quote }) => ({ quote: { ...quote, budgetFit: budgetFit(quote.unitPrice, anchor, params) }, profile }));
  const byPrice = (a: (typeof picks)[number], b: (typeof picks)[number]) =>
    a.quote.unitPrice - b.quote.unitPrice || (a.quote.departTime ?? '').localeCompare(b.quote.departTime ?? '') || a.quote.flightKey.localeCompare(b.quote.flightKey);
  const sorted = [...picks].sort(byPrice);
  const fits = sorted.filter((p) => p.quote.budgetFit >= params.minFit);
  const isGoodTime = ({ quote: q }: (typeof picks)[number]) =>
    input.leg === 'outbound'
      ? q.departTime !== null && q.arriveTime !== null && q.departTime >= params.earliestDeparture && q.arriveTime <= params.checkInTime
      : q.departTime !== null && q.departTime >= params.returnAfter;

  const ranked: Record<FlightGroupCode, { item: Omit<FlightPick, 'badges'>; text: string }[]> = {
    cheapest: sorted.map((p) => ({ item: p.quote, text: `${formatVnd(p.quote.unitPrice)}/người` })),
    good_time: fits
      .filter(isGoodTime)
      .map((p) => ({ item: p.quote, text: input.leg === 'outbound' ? `Tới ${p.quote.arriveTime}, kịp nhận phòng` : `Bay ${p.quote.departTime}, trọn buổi sáng cuối` })),
    // Chỉ có khi trên tuyến có chuyến nhanh, chậm khác nhau (speedRank khác null).
    fastest: fits
      .filter((p) => p.profile?.speedRank != null && p.profile.durationMinutes !== null)
      .sort((a, b) => a.profile!.durationMinutes! - b.profile!.durationMinutes! || byPrice(a, b))
      .map((p) => {
        const m = p.profile!.durationMinutes!;
        return { item: p.quote, text: `Bay ${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}` };
      }),
    // Giá hiện là gói mặc định; gói hoàn huỷ có giá riêng ở bước chọn hạng vé. Mọi chuyến đều có (hoặc đều không) thì
    // nhãn không giúp chọn: bỏ nhóm, như "bay nhanh" khi mọi chuyến bay lâu như nhau.
    flexible: picks.some((p) => !p.profile?.hasRefundableFare)
      ? fits.filter((p) => p.profile?.hasRefundableFare).map((p) => ({ item: p.quote, text: 'Có hạng vé hoàn huỷ được' }))
      : [],
    popular: fits
      .filter((p) => (p.profile?.bookings30d ?? 0) > 0)
      .sort((a, b) => b.profile!.popularity * b.quote.budgetFit - a.profile!.popularity * a.quote.budgetFit || byPrice(a, b))
      .map((p) => ({ item: p.quote, text: `${p.profile!.bookings30d} lượt đặt trong 30 ngày` })),
  };

  const grouped = buildGroups(FLIGHT_GROUP_ORDER[budget], FLIGHT_GROUPS, ranked, (q) => q.flightKey, input.perGroup);
  // Trả mọi chuyến trong nhóm, cộng thêm chuyến rẻ cho đủ minOptions (để có nhiều lựa chọn); cả danh sách rẻ trước.
  const shown = new Set([...grouped.picks.keys(), ...sorted.slice(0, params.minOptions).map((p) => p.quote.flightKey)]);
  const items: FlightPick[] = sorted
    .filter((p) => shown.has(p.quote.flightKey))
    .map((p) => ({ ...p.quote, badges: grouped.picks.get(p.quote.flightKey)?.badges ?? [] }));
  return { items, groups: grouped.groups, budgetAnchor: anchor === null ? null : Math.round(anchor), budget };
}
