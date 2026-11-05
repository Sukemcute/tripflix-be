# TF10 — Đánh giá khách sạn (phần backend)

- Notion: <dán link task TF10> · Nhánh: `thang/TF10-danh-gia-khach-san` · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-05

## Đã làm (module commerce)
- Bảng mới `commerce.reviews` (migration `20261105164753_add_hotel_reviews`, chỉ `CREATE TABLE`, không sửa migration cũ): khách sạn, loại phòng đã ở, `booking_id` (duy nhất: mỗi booking một đánh giá), `user_id`, tên hiển thị, số sao (CHECK 1–5), tiêu đề, nội dung, tag, ảnh (khoá S3), kiểu khách, tháng lưu trú, số lượt hữu ích, `status` (`published` | `hidden`, ẩn khi kiểm duyệt chứ không xoá), `is_seeded`.
- `properties.details.reviewSummary`: đoạn tóm tắt ý kiến khách (chỗ để sau này AI sinh; hiện là dữ liệu demo). Không cần cột mới.
- API mới `GET /api/hotels/:id/reviews?sort=newest|highest|lowest|helpful&rating=&tag=&travelerType=&page=&limit=`: công khai, chỉ đọc, chỉ trả đánh giá `published`.
  - `summary`: điểm trung bình, số đánh giá, phân bố 5→1 sao, 10 tag nhiều nhất kèm số lần (giống chip "Phù hợp gia đình 58"), `aiSummary`. Thống kê tính trên mọi đánh giá, không theo bộ lọc.
  - `items`: tên, sao, tiêu đề, nội dung, tag, ảnh (URL CloudFront), kiểu khách, tháng ở, phòng đã ở, lượt hữu ích, ngày viết; `page`, `limit`, `total` (số khớp bộ lọc).
  - Sai tham số: 400 kèm tên trường; không có khách sạn: 404. Có trong `contracts/openapi/core-api.json` (chỉ thêm).
- Dữ liệu demo `db/seed/reviews.json`: 3.741 đánh giá **giả lập** cho 220 khách sạn (script tất định do Codex viết, Claude chạy, soát và chỉnh). Nội dung nhắc tiện ích, địa danh, phòng có thật trong `catalog.json`; điểm trung bình mỗi khách sạn lệch `ratingAvg` tối đa 0,1. Tên người viết là tên bịa, **không crawl đánh giá của trang khác** (điều khoản và bản quyền, dữ liệu cá nhân).
- Seed: `seedCatalog` gọi thêm `seedReviews` trong cùng transaction; chạy lại được, chỉ ghi đè dòng `is_seeded`, không đụng đánh giá thật. Ảnh đi qua cùng tiền tố `S3_KEY_PREFIX` như ảnh khách sạn.

## Chưa làm / phụ thuộc người khác
- Khách viết đánh giá sau khi ở (`POST`, kiểm tra booking đã hoàn tất của chính người đó): cần booking (TF29) đã merge; làm task sau.
- Tóm tắt bằng AI thật: cần endpoint bên `tripflix-ai` (Bảo).
- Ẩn đánh giá vi phạm: cột `status` đã có; luồng kiểm duyệt thuộc `moderation` (Trang).
- Giao diện mục đánh giá trên app (Trang) và web (Thành).

## Kết quả kiểm tra
- `vitest run` (core-api): **243/243 pass**; 3 test mới trong `hotels.e2e.spec.ts`: thống kê + tóm tắt + mới nhất trước, bỏ đánh giá đã ẩn và của khách sạn khác; lọc tag, số sao, sắp theo hữu ích, phân trang; khách sạn chưa có đánh giá, 404, 400.
- `vitest run --config vitest.int.config.ts` (Postgres thật): **24/24 pass**; test mới: seed nạp đánh giá, thống kê khớp SQL, lọc tag `jsonb`, sắp xếp, phân trang, ẩn thì không đếm.
- `tsc --noEmit` pass, `oxlint` sạch ở commerce, `check-boundaries` không vi phạm.
- Chạy thật: migrate + seed (3.741 đánh giá, trung bình 4,51), `GET /api/hotels/P-h-nt-01/reviews?limit=2&sort=helpful` trả 200: 14 đánh giá, trung bình 4,6, tag "Đáng tiền" 8, ảnh URL CloudFront; khách sạn không có 404; `rating=9` 400.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api build`, `pnpm db:migrate`.
2. `S3_KEY_PREFIX=dev/thang/ pnpm db:seed` (ảnh đánh giá dùng ảnh khách sạn ở `dev/thang/`).
3. Chạy core-api, gọi `GET /api/hotels/P-h-nt-01/reviews`.

## Ảnh / video
- Chưa có: chờ giao diện app và web.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `modules/commerce` và sinh lại `contracts/openapi/core-api.json` (chỉ thêm). Không sửa `cli/seed.ts`.
- Nhánh tách từ `thang/TF10-trang-chi-tiet-khach-san`: mở PR sau PR đó (hoặc đặt base là nhánh đó).
