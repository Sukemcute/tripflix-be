# TF28 — Có chuyến vẫn gợi ý nơi vừa tìm; thêm Hà Giang, Sa Pa, Cô Tô vào danh sách nơi

- Jira: TF28 · Nhánh: `duy/TF28-dang-di-van-goi-y-noi-moi` · Người làm: Lê Anh Duy (dùng AI: có) · Ngày: 2026-11-19

## Đã làm
- **Có chuyến không còn khoá gợi ý vào chuyến** (`rankers/trip-v1.ts`): sắp đi / đang đi / vừa về trước đây đặt trọng số "nơi đang tìm hiểu" = 0. Trên server: tài khoản có đơn Đà Lạt 18/11, tìm + thích 3 bài Hà Giang và 3 bài Hội An → Bài viết và Reels "Dành cho bạn" không đổi gì. Nay phần này 0,2 (lấy bớt từ phần hot); chuyến vẫn giữ các bài đầu. Lý do: người đang đi vẫn lên kế hoạch chuyến sau, chuyến dài ngày đi nhiều nơi, đơn đặt hộ.
- **Thêm Hà Giang, Sa Pa, Cô Tô vào `PLACES`** (`search/domain/places.ts`, tag trong `recommend/domain/topics.ts`): lexicon tìm khám phá nhận ra ba nơi này nhưng `PLACES` không có id → lượt tìm ghi `placeIds: []`, bài không có `place_id`, thích bài Hà Giang không thành "đang tìm hiểu Hà Giang". Thêm làm điểm đến thuộc tỉnh sau sáp nhập (Tuyên Quang, Lào Cai, Quảng Ninh). Job hồ sơ bài tự gán lại nơi cho bài cũ ở lượt chạy kế tiếp; lượt tìm cũ đã ghi không có nơi thì không tính lại.

## Đối chiếu "Xong khi"
| Tiêu chí (yêu cầu của Duy 19/11) | Đạt | Bằng chứng |
|---|---|---|
| Đang có chuyến mà tìm / thích nơi khác thì nơi đó lên gợi ý | Có | Test "đang đi mà vừa tìm và thích bài nơi khác…" (fail với trọng số cũ); local: member đang đi Nha Trang 19–22/11, tìm + thích Hà Giang, Hội An → 4 bài đầu chuyến Nha Trang, 20 bài đầu có Hà Giang ×5, Hội An ×3 |
| Tìm "hà giang" được hiểu là nơi | Có | `search-events.publisher.spec.ts` (placeIds `['ha-giang']`), `place-of-post.spec.ts`; local `recommend_posts`: Hà Giang 35, Sa Pa 52, Cô Tô 41 bài có nơi |

## Kết quả kiểm tra
- Test discovery: 389 pass (4 skip có sẵn).
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 0 lỗi lint, typecheck sạch.
- Bộ đo offline (`recommend/eval/report.md`): "đúng nơi" của sắp đi / đang đi giữ 0,40, khách sạn khác giữ 0; số nơi trong 20 bài tăng 1–3 ở các ca.

## Cách kiểm lại
1. Tài khoản có đơn đang đi (vd member local, đơn Nha Trang 19–22/11).
2. Tìm "hà giang", thả tim 2–3 bài Hà Giang; mở `GET /api/recommendations/posts?mode=for_you&postType=vlog`.
3. Các bài đầu vẫn "Cho chuyến … của bạn", ngay sau có bài Hà Giang "Vì bạn đang tìm hiểu Hà Giang".

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa `discovery`. Ô gợi ý nơi của web OTA (`/api/search/places`) sẽ có thêm 3 điểm đến.
