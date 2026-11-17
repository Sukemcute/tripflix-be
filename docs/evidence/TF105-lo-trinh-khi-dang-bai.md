# TF105 — Lộ trình kèm bài đăng (BE)

- Jira: SCRUM-173 · Nhánh: `thang/TF105-lo-trinh-khi-dang-bai` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-17
- FE đi kèm: `tripflix-fe-team/docs/evidence/TF105-lo-trinh-khi-dang-bai.md`

## Đã làm
- **Lộ trình (`trip_attachment`, jsonb)**, chỉ thêm trường tuỳ chọn, tương thích bài cũ:
  - mỗi điểm: `time` (HH:mm), `hotel` { `hotelId`, `productId`, `ratePlanCode` } để một chuyến có nhiều khách sạn;
  - cả lộ trình: `posterMediaId`, `hotelProductId`, `hotelRatePlanCode`, `destinationPlaceId`.
- `prepareTripAttachment` làm sạch trước khi lưu (tạo nháp, sửa bài): bỏ `posterUrl` client gửi, bỏ giờ sai dạng, chỉ giữ khách sạn có mã, poster phải là ảnh đã tải xong của chính tác giả.
- Đọc bài: gắn `posterUrl` cho lộ trình (feed và chi tiết bài); sửa `getMaskedTripAttachment` làm mất giờ, khách sạn từng điểm và loại phòng.
- **Commerce**: đơn trả thêm `propertyId`, `fromAirport`, `toAirport` của từng mục để FE dựng lộ trình từ chuyến đã đi.
- Sinh lại `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Lưu lộ trình có giờ, nhiều khách sạn, poster | Có | `trip-attachment.spec.ts` (9 test) |
| Poster không phải ảnh của mình thì bị từ chối | Có | `trip-attachment.spec.ts` |
| Feed trả poster lộ trình | Có | `feed.use-cases.spec.ts` |
| Đơn có đủ dữ liệu dựng lộ trình | Có | `checkout.int.spec.ts` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 48/49 task; `core-api` 2654 test qua, 2 lỗi, 4 bỏ qua.
- 2 test lỗi có sẵn trên develop, không liên quan: `comment.entity.spec.ts` và `post-summary-and-flat-comments.spec.ts` (giới hạn bình luận 2.000 ký tự).
- Chạy thật local: đăng reel kèm lộ trình nhiều khách sạn từ mobile, bài lưu đúng, video-worker chuyển mã xong.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api dev`, `pnpm --filter @tripflix/video-worker dev` (video-worker cần `.env` với khoá AWS dev).
2. `POST /api/v1/posts` với `trip_attachment.items[].hotel` và `time`; `GET /api/v1/posts/:id` trả lại đủ.
3. `GET /api/checkout/:id` có `propertyId`, `fromAirport`, `toAirport`.

## Ảnh hưởng tới phần của người khác
- `content/social` (Thành): DTO, entity, schema jsonb, use case tạo/sửa bài — chỉ thêm trường tuỳ chọn.
- `content/feed` (Phong): gắn poster lộ trình khi trả feed.
- `commerce` (Thắng): phần của mình.
