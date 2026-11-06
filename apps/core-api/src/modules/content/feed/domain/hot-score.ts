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
