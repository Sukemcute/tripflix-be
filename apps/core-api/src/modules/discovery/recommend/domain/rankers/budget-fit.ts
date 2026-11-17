// Độ hợp ngân sách dùng chung cho ranker trip_stays@v0 và trip_flights@v0 (TF39).

export const BUDGET_LEVELS = ['saving', 'moderate', 'premium'] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

export interface BudgetParams {
  /** Mốc ngân sách = phân vị này của giá các lựa chọn còn chỗ (đúng ngày). premium: không có mốc. */
  budgetPercentile: Record<Exclude<BudgetLevel, 'premium'>, number>;
  /** Không có ngân sách của người dùng thì dùng mức này. */
  defaultBudget: BudgetLevel;
  /** Giá đến chừng này lần mốc vẫn coi là hợp (độ hợp = 1). */
  tolerance: number;
  /** Vượt quá thì độ hợp giảm theo exp(-steepness × phần vượt). */
  steepness: number;
  /** Độ hợp dưới mức này thì không vào nhóm nào trừ nhóm giá rẻ. */
  minFit: number;
}

/** Người dùng chọn nhiều mức chi phí thì lấy mức thoáng nhất (cao cấp > vừa phải > tiết kiệm). */
export function pickBudget(levels: readonly BudgetLevel[] | null | undefined, fallback: BudgetLevel): BudgetLevel {
  if (!levels?.length) return fallback;
  return [...BUDGET_LEVELS].reverse().find((level) => levels.includes(level)) ?? fallback;
}

/** Phân vị nội suy tuyến tính (như numpy.percentile). */
function percentileOf(sorted: readonly number[], p: number): number {
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Mốc giá theo ngân sách trên giá thật của các lựa chọn; null khi cao cấp hoặc không có giá. */
export function budgetAnchor(prices: readonly number[], budget: BudgetLevel, params: BudgetParams): number | null {
  if (budget === 'premium' || !prices.length) return null;
  return percentileOf([...prices].sort((a, b) => a - b), params.budgetPercentile[budget]);
}

/** 1 khi giá ≤ tolerance × mốc; vượt thì exp(-steepness × phần vượt). Không có mốc thì 1. */
export function budgetFit(price: number, anchor: number | null, params: BudgetParams): number {
  if (anchor === null) return 1;
  const over = price / (anchor * params.tolerance) - 1;
  return over <= 0 ? 1 : Math.round(Math.exp(-params.steepness * over) * 10_000) / 10_000;
}
