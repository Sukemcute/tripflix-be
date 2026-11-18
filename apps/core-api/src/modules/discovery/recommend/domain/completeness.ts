import { round4 } from './contracts.js';

export const COMPLETENESS_WEIGHTS = {
  media: 0.25,
  caption: 0.2,
  hashtag: 0.1,
  plan: 0.3,
  tripInfo: 0.15,
} as const;

export interface CompletenessInput {
  mediaIds: string[];
  coverMediaId: string | null;
  body: string;
  hashtags: string[];
  tripAttachment: {
    items?: unknown[];
    daysCount?: number;
    destinationName?: string;
    destinationPlaceId?: string;
    estimatedCostPerPerson?: number;
  } | null;
}

/** Mục lịch trình đọc từ JSON của content (TripItineraryItem); kiểu lỏng vì dữ liệu cũ có thể thiếu trường. */
interface PlanItem {
  day?: unknown;
  location?: unknown;
  hotel?: unknown;
  transport?: unknown;
}

const planItems = (p: CompletenessInput): PlanItem[] =>
  (p.tripAttachment?.items ?? []).filter((x): x is PlanItem => typeof x === 'object' && x !== null);

/**
 * Bài có lịch trình khi có ít nhất một mục lịch trình. Chỉ ghi số ngày (daysCount) mà không có mục nào là lịch trình rỗng,
 * không tính (mode has_plan không trả bài này).
 */
export function hasPlan(p: CompletenessInput): boolean {
  return planItems(p).length > 0;
}

/**
 * Mức đầy đủ của lịch trình 0..1, không phụ thuộc chuyến dài hay ngắn (đều là tỉ lệ):
 * 0,6 × độ phủ ngày (số ngày 1..daysCount có ít nhất một mục ÷ daysCount; thiếu daysCount thì lấy ngày lớn nhất trong mục)
 * + 0,4 × tỉ lệ mục có nơi (location, khách sạn hoặc chặng đi lại). Không có mục nào thì 0.
 */
export function planFullness(p: CompletenessInput): number {
  const items = planItems(p);
  if (!items.length) return 0;
  const days = items.flatMap((i) => (typeof i.day === 'number' && Number.isInteger(i.day) && i.day >= 1 ? [i.day] : []));
  const declared = p.tripAttachment?.daysCount ?? 0;
  const totalDays = declared > 0 ? declared : Math.max(0, ...days);
  // Ngày vượt daysCount (nhập sai) không tính, để độ phủ không vượt 1.
  const coveredDays = new Set(days.filter((d) => d <= totalDays)).size;
  const dayCoverage = totalDays > 0 ? coveredDays / totalDays : 0;
  const hasPlace = (i: PlanItem) => (typeof i.location === 'string' && i.location.trim().length > 0) || Boolean(i.hotel) || Boolean(i.transport);
  const placeRatio = items.filter(hasPlace).length / items.length;
  return 0.6 * dayCoverage + 0.4 * placeRatio;
}

/** Thông tin chuyến 0..1: điểm đến, số ngày, chi phí mỗi thứ một phần ba (có điền là được, không xét giá trị lớn nhỏ). */
export function tripInfoFullness(p: CompletenessInput): number {
  const trip = p.tripAttachment;
  if (!trip) return 0;
  const hasDestination = Boolean(trip.destinationName?.trim()) || Boolean(trip.destinationPlaceId?.trim());
  const hasDays = (trip.daysCount ?? 0) > 0;
  const hasCost = (trip.estimatedCostPerPerson ?? 0) > 0;
  return [hasDestination, hasDays, hasCost].filter(Boolean).length / 3;
}

/** Điểm hoàn thiện bài viết trong [0, 1], làm tròn 4 chữ số thập phân. */
export function calculateCompleteness(p: CompletenessInput): number {
  let score = 0;

  if (p.mediaIds.length > 0 || Boolean(p.coverMediaId)) {
    score += COMPLETENESS_WEIGHTS.media;
  }
  if (p.body.trim().length >= 30) {
    score += COMPLETENESS_WEIGHTS.caption;
  }
  if (p.hashtags.length > 0) {
    score += COMPLETENESS_WEIGHTS.hashtag;
  }
  score += COMPLETENESS_WEIGHTS.plan * planFullness(p);
  score += COMPLETENESS_WEIGHTS.tripInfo * tripInfoFullness(p);

  return round4(Math.min(1, Math.max(0, score)));
}
