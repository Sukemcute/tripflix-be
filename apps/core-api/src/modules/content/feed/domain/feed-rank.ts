/**
 * Thứ tự hiển thị Reels ở hai tab (13/11, Phong chốt):
 * - Dành cho bạn: bài có tương tác xếp theo điểm có bán rã theo tuổi bài,
 *   ln(1 + điểm hot) / (giờ tuổi + 2)^1.2 (cùng dạng hot@v0 bên discovery);
 *   bài chưa có tương tác (điểm 0) nhận điểm ngẫu nhiên trong [0, FOR_YOU_UNSCORED_CEILING) nên chen xen vào.
 * - Đang hot: giữ điểm hot hiện tại; bằng điểm (gồm các bài 0 điểm) thì xếp ngẫu nhiên thay vì mới nhất trước.
 *
 * "Ngẫu nhiên" là băm cố định của (seed, id bài): cùng seed thì cùng thứ tự, nên sang trang không lặp, không rớt bài.
 * Mỗi lần tải lại trang đầu chọn seed mới trong FEED_SEED_COUNT giá trị, đủ để thứ tự gần như luôn đổi
 * mà cache trang đầu (mỗi seed một khoá) vẫn còn tác dụng khi đông người.
 */
export const FEED_SEED_COUNT = 16;

/** Cộng vào giờ tuổi để bài vừa đăng không chia cho 0 và không vọt quá cao. */
export const FOR_YOU_AGE_OFFSET_HOURS = 2;
/** Bài cũ đi thì điểm giảm theo luỹ thừa này của giờ tuổi; lớn hơn thì bài mới lên nhanh hơn. */
export const FOR_YOU_GRAVITY = 1.2;
/**
 * Trần điểm ngẫu nhiên cho bài chưa có tương tác: ngang một bài 1 lượt thích đăng khoảng 6 giờ trước
 * (ln 2 / 8^1.2 ≈ 0,057). Bài có tương tác mới đăng vẫn đứng trên, bài cũ ít tương tác bị bài mới chen qua.
 */
export const FOR_YOU_UNSCORED_CEILING = 0.05;

export function pickFeedSeed(random: () => number = Math.random): number {
  return Math.min(FEED_SEED_COUNT - 1, Math.floor(random() * FEED_SEED_COUNT));
}
