/**
 * Điểm Hot của feed (TF111, docs/10 mục Xu hướng):
 * điểm thô = log10(1 + Σ trọng_số × 0,5^(tuổi_tương_tác / 48h)) × (0,5 + 0,5 × độ_hoàn_thiện),
 * rồi chuẩn hoá theo p99 của cả lô về [0, 1] để cùng thang với hot@v2 của discovery.
 */

/** Trọng số theo docs/10. Chia sẻ chưa có dữ liệu (chưa có code nào ghi lượt chia sẻ) nên chưa góp điểm. */
export const HOT_TREND_WEIGHTS = {
  view: 1,
  like: 1,
  comment: 2,
  save: 3,
  share: 4,
  bookingClick: 5,
} as const;

/** Cứ 48 giờ không ai tương tác thì điểm giảm một nửa. */
export const HOT_HALF_LIFE_HOURS = 48;

/** Lượt xem của khách chỉ tính một nửa (docs/10, chống đẩy ảo). */
export const HOT_GUEST_VIEW_FACTOR = 0.5;

/** Chỉ chấm bài đăng trong chừng này ngày: tín hiệu cũ hơn đã gần như về 0, và để mỗi lượt không phải chấm mọi bài. */
export const HOT_CANDIDATE_DAYS = 30;

/** Số chữ số thập phân của điểm đã chuẩn hoá; cursor tab hot so sánh đúng giá trị này. */
const SCORE_DECIMALS = 6;

/** Phần tín hiệu sau bán rã quy về hệ số nhân: một tương tác cách đây `ageHours` giờ còn lại chừng này. */
export function decayFactor(ageHours: number): number {
  return 0.5 ** (Math.max(0, ageHours) / HOT_HALF_LIFE_HOURS);
}

/** `decayedSignal` là Σ trọng_số × decayFactor của bài; `completeness` trong [0, 1]. */
export function calculateHotRaw(decayedSignal: number, completeness: number): number {
  const boundedCompleteness = Math.min(1, Math.max(0, completeness));
  return Math.log10(1 + Math.max(0, decayedSignal)) * (0.5 + 0.5 * boundedCompleteness);
}

/** Phân vị kiểu numpy.percentile (nội suy tuyến tính), giống discovery để hai thang điểm so được với nhau. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (p / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

/** Chia cho p99 của cả lô rồi kẹp [0, 1]: vài bài đột biến không đẩy mọi bài còn lại về gần 0. */
export function normalizeHotScores<T extends { raw: number }>(rows: readonly T[]): Array<T & { score: number }> {
  const p99 = percentile(
    rows.map((row) => row.raw),
    99,
  );
  const factor = 10 ** SCORE_DECIMALS;
  return rows.map((row) => ({
    ...row,
    score: p99 > 0 ? Math.round(Math.min(1, Math.max(0, row.raw / p99)) * factor) / factor : 0,
  }));
}
