# TF30 — Sửa K1–K4: nhả chỗ, deadlock đổi giỏ, mã xác nhận, đối soát tồn kho

- Notion: <dán link task TF30> · Nhánh: `thang/TF30-sua-ton-kho-k1-k4` (phụ thuộc PR TF29 `thang/TF29-lich-nap-tang-dan-tra-tien`) · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
Bốn lỗi tồn kho tìm ra trong đợt rà soát Booking + Payment ngày 13/11:

- **K1, job nhả chỗ chỉ xử lý 500 đơn mỗi phút.** `ExpireHoldsUseCases` giờ lặp tới khi lô trả về ít hơn 500 đơn. Dừng sớm khi cả lô không nhả được đơn nào (đơn đang bị khoá, lượt sau xét lại) hoặc đã chạy quá 45 giây.
- **K2, đổi giỏ gây deadlock và trả 500.** Trước đây giữ giỏ mới thì nhả hết ô của giỏ cũ rồi mới giữ ô mới, nên thứ tự khoá toàn cục bị phá.
  - Giờ ô nhả và ô giữ khoá chung một thứ tự (sản phẩm, ngày); cùng ô thì nhả trước (`listCellLockOrder`).
  - Gặp `40P01` thì chạy lại `holdAndCreateOrder` một lần. Transaction đã rollback nên chạy lại an toàn.
  - Thêm `isDeadlock` vào `OrderStore`.
- **K3, mã xác nhận 6 ký tự, không có ràng buộc duy nhất.**
  - Tăng lên 8 ký tự (`CONFIRMATION_CODE_LENGTH`) và thêm `uq_orders_confirmation_code`.
  - Migration `20261116072131_orders_confirmation_code_unique` đổi mã các đơn đang trùng trước khi tạo index: giữ mã của đơn tạo sớm nhất, đơn sau thêm 2 ký tự lấy từ id.
- **K4, lệch tồn kho không ai thấy.**
  - Thêm `ReconcileInventoryJob`, chạy mỗi giờ khi `APP_ROLE` là `worker` hoặc `all`. Job so `held`/`sold` của từng ô với tổng số lượng của các đơn `pending`/`paying`/`paid` trong một câu SQL.
  - Lệch thì chỉ ghi cảnh báo, không tự sửa kho.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Job nhả hết đơn quá hạn trong một lượt | Có | `expire-holds.use-cases.spec.ts`: 1.200 đơn, 3 lô, một lượt. Đo local: khoảng 89 đơn/giây (trước 500 đơn/phút) |
| Đổi giỏ không còn trả 500 | Có | Chạy lại kịch bản tái hiện: 20/20 lượt không lỗi 5xx, log Postgres không có `deadlock detected` (trước 19/20 lượt lỗi). Test: `lock-order.spec.ts`, `checkout-gate.spec.ts` |
| Mã xác nhận không trùng | Có | Database local có 1 cặp trùng trong 46.073 đơn; sau migration không còn mã trùng và có index duy nhất. Test: `order-rules.spec.ts` |
| Phát hiện lệch tồn kho | Có | `reconcile-inventory.use-cases.spec.ts`; chạy trên dữ liệu local khoảng 1,4 giây, không có ô lệch |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 2.489 test qua, 2 hỏng, 4 bỏ qua.
- 2 test hỏng ở `content/social` do locale vi-VN (`2.000` thay vì `2,000`). Hỏng từ trước, không liên quan tới PR này.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api db:migrate`.
2. `pnpm --filter @tripflix/core-api exec vitest run src/modules/commerce`.
3. Script tái hiện nằm ngoài repo, trong `reports/do-kiem-chung-2026-11-13/` của Thắng: `deadlock.mjs` cho K2; `make-holds.mjs` + `expire.mjs` cho K1.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Mã xác nhận đổi từ `TF-` + 6 ký tự thành 8 ký tự. Kiểu dữ liệu API vẫn là chuỗi, nhưng FE (Trang: app, Thành: web) cần kiểm tra không có chỗ nào phụ thuộc độ dài mã.
- Ngoài ra chỉ sửa trong `modules/commerce`; thêm migration mới, không sửa migration cũ.
