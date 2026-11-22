import type { StayResult } from '../../../search/domain/stays.js';
import type { HotelProfileFeatures } from '../builders/hotel-profile.js';
import { LIVELY_RADIUS_KM } from '../builders/hotel-profile.js';
import { buildGroups, formatKm, formatVnd, type Badge, type Grouped } from '../trip-addon-groups.js';
import { budgetAnchor, budgetFit, pickBudget, type BudgetLevel, type BudgetParams } from './budget-fit.js';

export { BUDGET_LEVELS, pickBudget, type BudgetLevel } from './budget-fit.js';

/**
 * trip_stays@v0: xếp khách sạn gợi ý thêm vào chuyến (F10, TF39) theo từng nhóm tiêu chí, trên hồ sơ của hotel_profile@v0
 * và giá thật của ngày ở. Mọi nhóm (trừ "giá tốt") nhân với độ hợp ngân sách: khách sạn đắt vượt xa mặt bằng không
 * lọt vào "gần chỗ đi chơi" chỉ vì ở gần. Hàm thuần, tất định.
 */
export const TRIP_STAYS_RANKER = 'trip_stays@v0';

export const STAY_GROUPS = {
  cheap: 'Giá tốt',
  top_rated: 'Đánh giá cao',
  near_sights: 'Gần chỗ đi chơi',
  lively: 'Nhiều chỗ ăn chơi',
  value: 'Đáng tiền',
  popular: 'Được đặt nhiều',
} as const;
export type StayGroupCode = keyof typeof STAY_GROUPS;

/** Thứ tự chip theo ngân sách: chip đầu là cái người dùng muốn xem nhất (cao cấp không cần "giá tốt" trước). */
export const STAY_GROUP_ORDER: Record<BudgetLevel, readonly StayGroupCode[]> = {
  saving: ['cheap', 'top_rated', 'near_sights', 'lively', 'popular', 'value'],
  moderate: ['cheap', 'top_rated', 'near_sights', 'lively', 'value', 'popular'],
  premium: ['top_rated', 'value', 'near_sights', 'lively', 'popular', 'cheap'],
};

/** Giá một đêm chia từ tổng tiền nên có số lẻ (353.333đ): làm tròn tới nghìn khi hiện. */
const perNight = (price: number) => `${formatVnd(Math.round(price / 1000) * 1000)}/đêm`;

/** Thông số chỉnh được mà không đổi logic. Đổi giá trị mặc định = đổi hành vi cho mọi người: ghi lại lý do. */
export interface TripStaysParams extends BudgetParams {
  minReviews: number;
  nearSightMaxKm: number;
  livelyMinPlaces: number;
  valueMinStars: number;
  /** "Đáng tiền": giá không quá tỉ lệ này so với trung vị cùng hạng sao. */
  valueMaxRatio: number;
}

export const DEFAULT_TRIP_STAYS_PARAMS: TripStaysParams = {
  budgetPercentile: { saving: 30, moderate: 60 },
  defaultBudget: 'moderate',
  tolerance: 1.3,
  steepness: 3,
  minFit: 0.5,
  minReviews: 10,
  nearSightMaxKm: 3,
  livelyMinPlaces: 10,
  valueMinStars: 4,
  valueMaxRatio: 0.9,
};

export interface TripStayCandidate extends StayResult {
  /** Hồ sơ hotel_profile@v0; null khi khách sạn chưa được dựng (mới thêm, job chưa chạy). */
  profile: HotelProfileFeatures | null;
}

export interface StayPick extends StayResult {
  nearestSight: { name: string; km: number } | null;
  placesNearby: number | null;
  /** 0..1: 1 là trong ngân sách; thấp dần khi giá vượt mốc. */
  budgetFit: number;
  badges: Badge<StayGroupCode>[];
}

export interface TripStaysResult extends Grouped<StayPick, StayGroupCode> {
  /** Mốc giá một đêm đang dùng; null khi ngân sách cao cấp hoặc không có giá. */
  budgetAnchor: number | null;
  budget: BudgetLevel;
}

export function rankTripStays(
  input: { candidates: readonly TripStayCandidate[]; budgetLevels?: readonly BudgetLevel[] | null; perGroup: number },
  params: TripStaysParams = DEFAULT_TRIP_STAYS_PARAMS,
): TripStaysResult {
  const budget = pickBudget(input.budgetLevels, params.defaultBudget);
  const anchor = budgetAnchor(
    input.candidates.map((c) => c.unitPrice),
    budget,
    params,
  );
  const fitOf = (price: number) => budgetFit(price, anchor, params);

  const picks = input.candidates.map((c) => {
    const { profile, ...stay } = c;
    return {
      stay: {
        ...stay,
        nearestSight: profile?.nearestSightName && profile.nearestSightKm !== null ? { name: profile.nearestSightName, km: profile.nearestSightKm } : null,
        placesNearby: profile?.placesNearby ?? null,
        budgetFit: fitOf(c.unitPrice),
      },
      profile,
    };
  });
  const byPrice = (a: { stay: StayResult }, b: { stay: StayResult }) => a.stay.unitPrice - b.stay.unitPrice || a.stay.name.localeCompare(b.stay.name, 'vi');
  const fits = picks.filter((p) => p.stay.budgetFit >= params.minFit);
  // Điểm nhóm cao trước; bằng điểm thì rẻ trước.
  const rankBy = (xs: typeof picks, score: (p: (typeof picks)[number]) => number) => [...xs].sort((a, b) => score(b) - score(a) || byPrice(a, b));

  const ranked: Record<StayGroupCode, { item: Omit<StayPick, 'badges'>; text: string }[]> = {
    cheap: [...picks].sort(byPrice).map((p) => ({ item: p.stay, text: perNight(p.stay.unitPrice) })),
    top_rated: rankBy(
      fits.filter((p) => p.profile?.ratingScore != null && p.profile.ratingCount >= params.minReviews),
      (p) => p.profile!.ratingScore! * p.stay.budgetFit,
    ).map((p) => ({ item: p.stay, text: `${p.profile!.ratingAverage!.toFixed(1).replace('.', ',')}/5 · ${p.profile!.ratingCount} đánh giá` })),
    near_sights: rankBy(
      fits.filter((p) => p.stay.nearestSight && p.stay.nearestSight.km <= params.nearSightMaxKm),
      (p) => p.stay.budgetFit / (1 + p.stay.nearestSight!.km),
    ).map((p) => ({ item: p.stay, text: `Cách ${p.stay.nearestSight!.name} ${formatKm(p.stay.nearestSight!.km)}` })),
    lively: rankBy(
      fits.filter((p) => (p.stay.placesNearby ?? 0) >= params.livelyMinPlaces),
      (p) => p.stay.placesNearby! * p.stay.budgetFit,
    ).map((p) => ({ item: p.stay, text: `${p.stay.placesNearby} chỗ ăn chơi trong ${formatKm(LIVELY_RADIUS_KM)}` })),
    value: rankBy(
      fits.filter((p) => (p.stay.stars ?? 0) >= params.valueMinStars && p.profile?.valueRatio != null && p.profile.valueRatio <= params.valueMaxRatio),
      (p) => (1 - p.profile!.valueRatio!) * p.stay.budgetFit,
    ).map((p) => ({ item: p.stay, text: `${p.stay.stars}★ rẻ hơn ${Math.round((1 - p.profile!.valueRatio!) * 100)}% so với khách sạn ${p.stay.stars}★ cùng nơi` })),
    popular: rankBy(
      fits.filter((p) => (p.profile?.bookings30d ?? 0) > 0),
      (p) => p.profile!.popularity * p.stay.budgetFit,
    ).map((p) => ({ item: p.stay, text: `${p.profile!.bookings30d} lượt đặt trong 30 ngày` })),
  };

  const grouped = buildGroups(STAY_GROUP_ORDER[budget], STAY_GROUPS, ranked, (s) => s.hotelId, input.perGroup);
  return {
    items: [...grouped.picks.values()].map(({ item, badges }) => ({ ...item, badges })),
    groups: grouped.groups,
    budgetAnchor: anchor === null ? null : Math.round(anchor),
    budget,
  };
}
