# TF43 — Đơn bất thường cho quản trị

- Notion: TF43 · Nhánh: `thang/TF43-don-bat-thuong-quan-tri` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-19

## Đã làm
- `GET /api/admin/commerce/orders`: tra đơn theo mã xác nhận, mã đơn, mã người dùng, số điện thoại, email; lọc `status`, phân trang `before`.
- `GET /api/admin/commerce/orders/:id`: hồ sơ đơn gồm mục, khách, khoản trừ, khoản hoàn, lịch sử trạng thái (D1) và các bất thường của đơn.
- `GET /api/admin/commerce/anomalies?kind=`: 6 loại bất thường, cũ nhất trước, kèm số đếm:
  - `double_charge`: từ hai khoản đã vào tiền mà chưa hoàn (gồm khoản `failed` nhưng cổng có giờ trả).
  - `charged_without_seat`: đã trừ tiền mà đơn không thành `paid` (chờ 10 phút để job đối soát chốt xong).
  - `paid_without_seat`: đơn `paid` mà kho ghi thiếu chỗ bán ở một ngày, hoặc mục chưa có mã xác nhận.
  - `paid_amount_mismatch`: đơn `paid` mà số trừ thành công khác tổng đơn.
  - `stuck_payment`: khoản trừ chờ cổng quá 30 phút hoặc đã chuyển người xử lý.
  - `refund_needs_review`: khoản hoàn cần người xử lý hoặc quá một ngày chưa xong (VNPay chưa hoàn tự động).
- Chỉ đọc, chỉ `superadmin` (có thông tin liên hệ khách). Không tự sửa kho hay hoàn tiền, cùng lý do với job đối soát K4.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| API tra đơn | Có | `admin-orders.int.spec.ts` › tra đơn theo mã xác nhận, điện thoại, email... |
| Phát hiện trừ hai lần | Có | › trừ hai lần: khoản failed nhưng cổng vẫn có giờ trả |
| Đã trả mà không có chỗ | Có | › đã trừ tiền mà đơn hết hạn; › đơn paid mà kho không ghi bán |

## Kết quả kiểm tra
- `vitest --config vitest.int.config.ts src/modules/commerce/admin`: 7/7 qua (Postgres thật qua testcontainers).
- `pnpm turbo run lint typecheck test --affected`: 48/49 task qua; core-api 2.846 test qua, 2 test hỏng là test bình luận 2.000 ký tự của `content/social` đã hỏng từ trước, không liên quan.
- `pnpm contracts:build`: thêm 3 đường dẫn vào `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. Bật Docker, `cd apps/core-api && pnpm exec vitest run --config vitest.int.config.ts src/modules/commerce/admin`.
2. Gọi `GET /api/admin/commerce/anomalies` bằng token superadmin.

## Ảnh / video
- Không đổi giao diện. Màn admin (`apps/admin`, Thành) chưa làm.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ thêm file trong `commerce` và đăng ký controller trong `commerce.module.ts`.
