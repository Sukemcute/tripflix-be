/** Chỉ số của bộ đo offline (thiết kế v1 mục 4). Hàm thuần trên danh sách placeId/postId đã xếp hạng. */

/** Có ít nhất một bài đáp án trong top k. null khi persona không có đáp án. */
export function hitAt(rankedIds: string[], holdout: string[], k: number): number | null {
  if (!holdout.length) return null;
  const top = new Set(rankedIds.slice(0, k));
  return holdout.some((id) => top.has(id)) ? 1 : 0;
}

/** Tỉ lệ bài trong top k ở một trong các nơi. null khi không có nơi để so. */
export function placeShareAt(rankedPlaces: Array<string | null>, places: string[], k: number): number | null {
  if (!places.length) return null;
  const top = rankedPlaces.slice(0, k);
  if (!top.length) return 0;
  return top.filter((p) => p !== null && places.includes(p)).length / top.length;
}

/** Số nơi khác nhau trong top k (bỏ bài không có nơi). */
export const placeCoverageAt = (rankedPlaces: Array<string | null>, k: number): number =>
  new Set(rankedPlaces.slice(0, k).filter((p) => p !== null)).size;

/** Chuỗi dài nhất các bài liền nhau cùng một nơi trong top k. */
export function maxSamePlaceRun(rankedPlaces: Array<string | null>, k: number): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const place of rankedPlaces.slice(0, k)) {
    run = place !== null && place === prev ? run + 1 : place === null ? 0 : 1;
    prev = place;
    best = Math.max(best, run);
  }
  return best;
}
