/**
 * Trọng số tương tác theo bộ đếm của bài, chỉ còn dùng trong điểm tab Dành cho bạn (feed-rank.ts).
 * Tab Đang hot đọc điểm có bán rã trong trend_scores từ TF111 (domain/hot-trend.ts).
 */
export const HOT_SCORE_WEIGHTS = { like: 1, comment: 2, save: 3, share: 4 } as const;
