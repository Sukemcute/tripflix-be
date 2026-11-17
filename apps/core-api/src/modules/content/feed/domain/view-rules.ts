/** Xem từ chừng này trở lên là "xem thật" dù video dài bao nhiêu (docs/architecture/10-nghiep-vu-kien-truc-feed.md mục 4.3). */
export const QUALIFIED_VIEW_MS = 15_000;
/** Hoặc xem được từ chừng này phần thời lượng, để video ngắn vẫn tính được. */
export const QUALIFIED_VIEW_SHARE = 0.5;

/** Lượt xem có đủ để coi là đã xem thật không. Chưa biết thời lượng thì chỉ xét mốc 15 giây. */
export function isQualifiedView(watchedMs: number, durationSec: number | null): boolean {
  if (watchedMs >= QUALIFIED_VIEW_MS) return true;
  return durationSec !== null && durationSec > 0 && watchedMs >= durationSec * 1000 * QUALIFIED_VIEW_SHARE;
}
