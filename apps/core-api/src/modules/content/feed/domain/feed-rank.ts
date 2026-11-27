/**
 * Thứ tự hiển thị Reels ở hai tab: điểm Hot trong trend_scores (TF111), bằng điểm (gồm các bài 0 điểm) thì xếp ngẫu nhiên
 * thay vì mới nhất trước. Từ TF121, Dành cho bạn dùng đúng thứ tự này thay cho điểm có bán rã chấm ở mỗi lần đọc
 * (chỉ chịu khoảng 10 req/s ở TF120).
 *
 * "Ngẫu nhiên" là băm cố định của (seed, id bài): cùng seed thì cùng thứ tự, nên sang trang không lặp, không rớt bài.
 * Mỗi lần tải lại trang đầu chọn seed mới trong FEED_SEED_COUNT giá trị, đủ để thứ tự gần như luôn đổi
 * mà cache trang đầu (mỗi seed một khoá) vẫn còn tác dụng khi đông người.
 */
export const FEED_SEED_COUNT = 16;

export function pickFeedSeed(random: () => number = Math.random): number {
  return Math.min(FEED_SEED_COUNT - 1, Math.floor(random() * FEED_SEED_COUNT));
}
