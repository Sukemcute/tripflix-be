# TF38 — Dấu "Đã xác thực" và quyền riêng tư của lộ trình

- Notion: https://notion.so/tripflix/TF38 · Nhánh: `thanh/TF02-social-content` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- **Quy trình gắn nhãn "Đã xác thực" (`is_verified` / Verified Badge)**:
  - Khi tác giả gọi xuất bản (`POST /v1/posts/:id/publish`), nếu bài viết có đính kèm đơn đặt phòng/vé (`booking_id`), tầng Application thông qua `COMMERCE_SERVICE_PORT` kiểm tra xác thực đơn hàng hoàn tất thanh toán và đã sử dụng.
  - Tự động gán `is_verified = true` khi hợp lệ, ngược lại gán `false`. Người dùng không thể tự can thiệp cờ này qua request body.
- **Bảo vệ quyền riêng tư & che giấu thông tin cá nhân (PII Masking)**:
  - Hiện thực logic `Post.getMaskedTripAttachment()` ở tầng Domain Entity và tầng Public Facade (`ContentFacade.getVisiblePosts()`).
  - Tự động xóa mã PNR, booking code nhạy cảm, thông tin hành khách (tên, số điện thoại, email), ẩn địa chỉ chi tiết chỉ giữ lại tên địa danh/thành phố, và chuyển đổi giá thành chi phí ước tính tham khảo (`estimated_cost`) kèm cảnh báo bắt buộc: `"Giá chỉ mang tính chất tham khảo"`.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Xác thực đơn đặt chỗ qua CommerceService để tự động gán `is_verified` | Đạt | `PublishPostUseCase`, test "gọi commerceService.verifyCompletedBooking" pass |
| Không cho phép client tự gửi `is_verified: true` | Đạt | Domain entity `Post.publish()` tự tính toán `is_verified` từ kết quả verify |
| Che giấu thông tin PII nhạy cảm trên lộ trình đính kèm khi công khai | Đạt | `post.entity.spec.ts` test "che giấu thông tin PII nhạy cảm" pass |
| Cung cấp PII Masking qua ContentFacade cho Discovery và Feed | Đạt | `content.facade.spec.ts` test "che PII trên trip_attachment" pass |
| 100% Lint, Typecheck, Unit Test pass | Đạt | `pnpm check` (62/62 tests pass) |

## Kết quả kiểm tra
- `pnpm lint`: 0 warnings, 0 errors.
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm typecheck`: Thành công trên toàn bộ workspace monorepo.
- `pnpm test`: 62/62 tests pass.

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm check`

## Ảnh / video
- Đợt cập nhật Backend Core API & Contracts: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không: Giao thức tích hợp với `Commerce` được trừu tượng hóa qua `COMMERCE_SERVICE_PORT`.
