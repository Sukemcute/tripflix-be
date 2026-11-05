# TF29 — Đặt khách sạn và vé máy bay, thanh toán giả lập

- Notion: <dán link task TF29> · Nhánh: `thang/TF29-dat-cho-thanh-toan-gia-lap` (tạo từ `thang/TF06-kho-san-pham-commerce`) · Người làm: Thắng Nguyễn Lê Phúc (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Bảng** (migration `20261105031326_add_orders_payments`): `orders`, `order_items`, `order_guests`, `payments`, `refunds`, `outbox_events` (libs/outbox), `idempotency_keys` (libs/idempotency), `mock_gateway_ops` (sổ của cổng giả lập, đóng vai hệ thống ngoài).
  - Database chặn: mỗi tài khoản một giỏ đang giữ (`uq_orders_one_pending_per_user`); một đơn tối đa một khoản trừ đang chạy hoặc đã thành công (`uq_payments_one_live_per_order`); khoá cổng duy nhất (`uq_payments_gateway_key`, `uq_refunds_gateway_key`).
- **Giữ chỗ + tạo đơn trong một transaction** (`@Transactional('commerce')`): giữ mọi ô bằng `UPDATE ... WHERE total - held - sold >= qty`, sắp ô theo (sản phẩm, ngày) để hai giỏ không deadlock; thiếu một ô thì rollback cả giỏ (409 kèm mục thiếu). Đơn `pending` hết hạn sau 30 phút. Giữ giỏ mới thì nhả giỏ cũ; đang có đơn `paying` thì chặn giữ giỏ mới; tối đa 30 lần giữ / giờ.
- **Trả tiền: TX1 → gọi cổng ngoài transaction → TX2** (docs/10 §3.4, không saga):
  - TX1: khoá đơn, kiểm thông tin khách, chính sách, số lần thử (tối đa 5), tính lại giá từ lịch trống (giá đổi → 409 `PRICE_CHANGED`, chưa trừ tiền); ghi payment `initiated`, đơn → `paying`.
  - TX2: `held → sold`, đơn → `paid`, mã xác nhận `TF-XXXXXX`, outbox `commerce.order.paid`. Thẻ bị từ chối → đơn về `pending`, lần sau khoá cổng mới.
  - Không rõ kết quả từ cổng (timeout, mất mạng) → 202, không coi là thất bại.
  - Tiền về khi đơn không còn chờ trả → **bù bằng hoàn tiền**, không chốt đơn.
- **Đối soát** (job 30 giây/lần, `APP_ROLE` worker / all): hỏi lại cổng các khoản kẹt; cổng chưa có thì huỷ lệnh trước rồi mới kết luận; giãn cách 1, 2, 5, 15, 60 phút; quá 30 lần thì chờ người xử lý; cổng lỗi liên tiếp thì tạm nghỉ. Hoàn tiền còn nợ thì làm nốt. Relay outbox commerce → `stream:core.commerce`.
- **Idempotency-Key** (libs/idempotency) cho `POST /checkout`, `/pay`, `/3ds`, `/pay-vnpay`.
- **Cổng thẻ giả lập** `MockGateway`: thẻ test, 3D Secure (OTP 123456), từ chối, tra cứu, huỷ, hoàn. Token thẻ lưu trong sổ của cổng nên chạy nhiều bản core-api vẫn đúng.
- **VNPay sandbox**: `POST /checkout/:id/pay-vnpay` trả URL đã ký (HMAC-SHA512); `GET /payments/vnpay/ipn` (VNPay gọi server, kiểm chữ ký, khoản trừ, số tiền; trả `RspCode` 00/01/02/04/97) và `GET /payments/vnpay/return` (trình duyệt quay về). Cả hai ghi kết quả bằng đúng TX2 của luồng thẻ. Bật khi có `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` trong `.env`.
  - `bankCode` (tuỳ chọn): `VNPAYQR` vào thẳng màn mã QR, `VNBANK` thẻ ATM / tài khoản nội địa, `INTCARD` thẻ quốc tế; bỏ trống thì khách tự chọn trên trang VNPay.
  - Khách bỏ ngang trang VNPay (đóng trang, phương thức bị từ chối) rồi trả lại: lần cũ chưa có kết quả được ghi `failed` (`vnpay_abandoned`) và tạo lần trả mới với mã mới, đơn không kẹt ở `paying`. Nếu sau đó VNPay vẫn báo lần cũ thành công thì TX2 chuyển sang hoàn tiền (bù), không trừ hai lần.
- Swagger / OpenAPI khai báo header `Idempotency-Key` (bắt buộc) cho `POST /checkout`, `/pay`, `/3ds`, `/pay-vnpay`.
- **CommerceFacade.verifyCompletedBooking(bookingId, userId)** cho content (Thành): đơn đã trả, đúng người, chuyến đã kết thúc.
- API: `POST /api/checkout`, `GET /api/checkout/:id`, `PUT /api/checkout/:id/guests`, `POST /api/checkout/:id/pay`, `POST /api/checkout/:id/3ds`, `POST /api/checkout/:id/cancel`, `POST /api/checkout/:id/pay-vnpay`, `GET /api/payments/vnpay/ipn|return`, `POST /api/mock-gateway/tokens`, `GET /api/mock-gateway/test-cards`.

## Chưa làm
- Job nhả chỗ hết hạn 30 phút và test tranh chỗ nhiều người: **TF30**.
- Giao diện đặt và trả tiền trên web (Thành) và app (Trang): họ gọi các API trên.
- VNPay: đối soát bằng `querydr` và hoàn tiền tự động qua VNPay (hiện khoản hoàn qua VNPay được chuyển người xử lý). Chạy IPN thật cần URL public (tunnel lúc dev) và gateway cho `/api/payments/vnpay/*` đi qua không kiểm token (Dũng).
- Huỷ đơn đã trả theo chính sách, khách không đến: làm sau (TF43 hoặc task mới).

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng |
|---|---|---|
| Đặt và thanh toán giả lập thành công | Đạt (API) | int test `đầu cuối: giữ chỗ → thông tin khách → trả tiền; held → sold; mã xác nhận; sự kiện commerce.order.paid` |
| … trên web và app | Chưa | Chờ giao diện của Thành, Trang gọi API |
| Không trừ tiền hai lần | Đạt | int test `bấm trả 5 lần cùng lúc cùng Idempotency-Key: đúng 1 khoản trừ ở cổng`; `mất phản hồi … đối soát chốt đúng 1 lần` |
| Thanh toán VNPay sandbox thật | Đạt | Thử tay 05/11: đơn `2b52f56b-…` → trang VNPay → thẻ NCB test → Return URL `isValidSignature: true, isSuccess: true` → đơn `paid`, mã `TF-SC8C7K`, giao dịch VNPay `15726397`, 2.510.000đ; đúng 1 sự kiện `commerce.order.paid` trong outbox |
| Server chết giữa chừng không mất tiền | Đạt | int test `cổng trừ tiền xong mà mất phản hồi`, `cổng sập trước khi trừ`, `tiền về khi đơn đã hết hạn: tự hoàn tiền` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api --filter=@tripflix/contracts`: lint 0 lỗi (43 cảnh báo đều ở module `content`, không phải commerce), typecheck pass, **core-api 153/153, contracts 2/2 test pass**.
- `pnpm --filter @tripflix/core-api test:int` (Postgres thật, Testcontainers): **32/32 pass**, trong đó TF29 có 15 test: đầu cuối, trả trùng 5 lần, thẻ từ chối, mất phản hồi, cổng sập, bù tiền, tranh phòng cuối, giỏ thiếu một mục, 3DS, giá đổi, phân quyền + thiếu key, `verifyCompletedBooking`, VNPay IPN (chữ ký, số tiền, gửi lại), VNPay huỷ, VNPay bỏ ngang rồi trả lại.
- `node tools/check-boundaries.mjs`: không vi phạm.
- `pnpm contracts:build`: `contracts/openapi/core-api.json` chỉ thêm 11 endpoint (kèm header `Idempotency-Key`, trường `bankCode`), không mất endpoint hay schema nào; thêm `contracts/events/commerce.order.paid.v1.schema.json`.

## Cách kiểm lại
1. `pnpm stack:infra`, `pnpm --filter @tripflix/core-api build`, rồi `pnpm db:migrate` và `pnpm db:seed` trong `apps/core-api`.
2. `pnpm --filter @tripflix/core-api test` và `pnpm --filter @tripflix/core-api test:int` (cần Docker).
3. Thử VNPay: điền `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` vào `apps/core-api/.env` (không commit), gọi `POST /api/checkout/:id/pay-vnpay`, mở `paymentUrl`, chọn NCB, thẻ `9704198526191432198`, `NGUYEN VAN A`, `07/15`, OTP `123456`.
4. Thử tay thẻ giả lập: lấy token thẻ `POST /api/mock-gateway/tokens {"cardNumber":"4242424242424242"}`, rồi `POST /api/checkout` → `PUT /guests` → `POST /pay` (header `Idempotency-Key`).

### Thử tay trên server thật (05/11, core-api cổng 3000, dữ liệu seed)
| Ca | Kết quả |
|---|---|
| Thẻ Visa test | 200 `paid`, mã `TF-QGNPKB` |
| Bấm trả 5 lần cùng lúc, cùng key và nội dung | 1 lần 200, 4 lần 409 (đang xử lý); gửi lại sau đó nhận đúng kết quả cũ (`Idempotency-Replayed: true`) |
| Cùng key nhưng nội dung khác (token thẻ khác) | 422, không xử lý |
| Thẻ bị từ chối rồi đổi thẻ | 402 `card_declined` → đơn `pending` → `paid` |
| 3D Secure | sai OTP 402, đúng OTP `paid` |
| Ngày trả phòng bị đóng (CTD) | 409, không giữ chỗ |
| VNPay `bankCode: VNPAYQR` | Trang VNPay báo "Ngân hàng thanh toán không được hỗ trợ": merchant test chưa bật VNPAYQR (cấu hình phía VNPay, không phải lỗi code) |
| VNPay thẻ nội địa NCB | `paid`, mã `TF-SC8C7K` (xem bảng trên) |

## Ảnh / video
- Không đổi giao diện. Thử tay qua Swagger (`/docs`) và trang thử nội bộ (không commit).

## Ảnh hưởng tới phần của người khác
- `libs/contracts/src/index.ts` (Dũng): **thêm** `CommerceOrderPaidV1Schema` và đăng ký `commerce.order.paid.v1`; không sửa schema có sẵn. Cần báo Dũng.
- `apps/core-api/package.json`: thêm phụ thuộc nội bộ `@tripflix/idempotency` (thư viện của nhóm, README ghi commerce dùng đầu tiên); `pnpm-lock.yaml` thêm 3 dòng.
- `apps/core-api/.env.example`: thêm biến `VNPAY_*` (để trống, không có khoá thật).
- Thành (content): có `CommerceFacade.verifyCompletedBooking` thật để thay bản giả trong `content.module.ts`.
- Dũng (gateway): cần cho `/api/payments/vnpay/*` đi qua không kiểm token khi chạy IPN thật.
