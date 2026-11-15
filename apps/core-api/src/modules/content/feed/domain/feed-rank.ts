/**
 * Thứ tự hiển thị Reels ở hai tab (13/11, Phong chốt):
 * - Dành cho bạn: ln(2 + điểm hot) / (giờ tuổi + 12)^0,4 × e^(FOR_YOU_SHUFFLE × (2u - 1)), u ∈ [0, 1) theo seed.
 *   Bán rã nhẹ và hệ số ngẫu nhiên từ ×0,37 tới ×2,7 để mỗi lần tải lại xáo mạnh và bài cũ nhiều tương tác
 *   vẫn hay lên đầu (pilot ít bài; trước đó bài 1–2 giờ tuổi chiếm đầu trang gần như mọi lần).
 *   Bài chưa có tương tác dùng chung công thức (ln 2), nên vẫn chen xen vào theo seed.
 * - Đang hot: giữ điểm hot hiện tại; bằng điểm (gồm các bài 0 điểm) thì xếp ngẫu nhiên thay vì mới nhất trước.
 *
 * "Ngẫu nhiên" là băm cố định của (seed, id bài): cùng seed thì cùng thứ tự, nên sang trang không lặp, không rớt bài.
 * Mỗi lần tải lại trang đầu chọn seed mới trong FEED_SEED_COUNT giá trị, đủ để thứ tự gần như luôn đổi
 * mà cache trang đầu (mỗi seed một khoá) vẫn còn tác dụng khi đông người.
 */
export const FEED_SEED_COUNT = 16;

/** Cộng vào giờ tuổi để bài vừa đăng không vọt quá cao so với bài một, hai ngày tuổi. */
export const FOR_YOU_AGE_OFFSET_HOURS = 12;
/** Bài cũ đi thì điểm giảm theo luỹ thừa này của giờ tuổi; lớn hơn thì bài mới lấn bài cũ mạnh hơn. */
export const FOR_YOU_GRAVITY = 0.4;
/**
 * Độ xáo: điểm nhân e^(±FOR_YOU_SHUFFLE). Với 1, bài hơn điểm quá e² ≈ 7,4 lần mới luôn đứng trên.
 * Mô phỏng trên 15 bài staging ngày 13/11: không bài nào lên đầu quá ~28% số lần tải, bài ≥ 3 ngày tuổi
 * lọt top 3 khoảng 96% số lần.
 */
export const FOR_YOU_SHUFFLE = 1;

export function pickFeedSeed(random: () => number = Math.random): number {
  return Math.min(FEED_SEED_COUNT - 1, Math.floor(random() * FEED_SEED_COUNT));
}
