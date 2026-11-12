/**
 * Tab hot chỉ xếp hạng bài đăng trong chừng này ngày: "đang hot" là bài gần đây, và để không phải chấm điểm mọi bài.
 * GIẢI PHÁP TẠM thay cho bán rã (docs/10, D7): bài cũ nhiều tương tác biến mất khỏi hot sau đúng 7 ngày thay vì giảm
 * dần. Khi có job điểm cộng dồn có bán rã thì bỏ cửa sổ này (hoặc nới rộng chỉ để giới hạn chi phí truy vấn).
 */
export const HOT_WINDOW_DAYS = 7;

/** Trọng số theo docs/10 mục trending. Bản đầu tính trên bộ đếm của bài, chưa có bán rã vì bộ đếm không lưu thời điểm tương tác. */
export const HOT_SCORE_WEIGHTS = { like: 1, comment: 2, save: 3, share: 4 } as const;

export interface HotScoreCounts {
  reactionTotal: number;
  commentCount: number;
  bookmarkCount: number;
  shareCount: number;
}

export function calculateHotScore(counts: HotScoreCounts): number {
  return (
    counts.reactionTotal * HOT_SCORE_WEIGHTS.like +
    counts.commentCount * HOT_SCORE_WEIGHTS.comment +
    counts.bookmarkCount * HOT_SCORE_WEIGHTS.save +
    counts.shareCount * HOT_SCORE_WEIGHTS.share
  );
}
