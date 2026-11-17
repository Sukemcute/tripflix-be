/**
 * Sở thích du lịch tự khai (onboarding mobile SCRUM-160, trang hồ sơ web): chỉ để gợi ý điểm đến.
 * Chỉ lưu, chưa module nào đọc. Thêm mã thì thêm vào cuối, không đổi tên mã đã có (đã lưu trong DB và trong máy người dùng).
 */
export const TRAVEL_INTERESTS = ['coast', 'nature', 'culture', 'food', 'city', 'stays'] as const;
/** Vùng muốn đi; sau này map ra danh sách nơi (PLACES của discovery). */
export const TRAVEL_REGIONS = ['north', 'central', 'highlands', 'south'] as const;
/** Mức chi phí muốn đi; sau này map ra khoảng giá (priceNight, cost của search) để ưu tiên nhẹ ở feed, không lọc cứng (lọc ngân sách là việc của search). */
export const TRAVEL_BUDGET_LEVELS = ['saving', 'moderate', 'premium'] as const;
export const TRAVEL_PREFERENCES_STATUSES = ['completed', 'skipped'] as const;

export interface TravelPreferences {
  status: (typeof TRAVEL_PREFERENCES_STATUSES)[number];
  interests: (typeof TRAVEL_INTERESTS)[number][];
  regions: (typeof TRAVEL_REGIONS)[number][];
  budgetLevels: (typeof TRAVEL_BUDGET_LEVELS)[number][];
  /** ISO; lúc người dùng bấm lưu trên máy, không phải lúc server nhận. */
  updatedAt: string;
}

/**
 * Bản gửi lên cũ hơn bản đang lưu thì bỏ qua: khách làm khảo sát trên máy rồi mới đăng nhập,
 * bản trong máy không được đè bản mới hơn đã lưu từ thiết bị khác. null (đặt lại) luôn áp dụng.
 */
export function isStaleTravelPreferences(incoming: TravelPreferences | null, current: TravelPreferences | null): boolean {
  if (!incoming || !current) return false;
  return Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt);
}
