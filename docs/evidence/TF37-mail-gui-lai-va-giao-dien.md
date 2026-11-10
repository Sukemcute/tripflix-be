# TF37 — Email xác nhận đặt chỗ: gửi lại khi SMTP lỗi, giao diện mới, thông tin liên hệ

- Notion: chưa có · Nhánh: `thang/TF37-link-don-trong-mail` · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-10

## Đã làm
- **Không mất mail khi SMTP/SES lỗi lâu.** Consumer `notification` thử tối đa 10 lần (khoảng 10 phút) thay vì 5. Sự kiện vẫn lỗi vào `stream:dead-letter`; job mới `DeadLetterReplayJob` quét mỗi `NOTIFICATION_DLQ_REPLAY_INTERVAL_MS` (mặc định 60 giây) và gửi lại các sự kiện của group `notification` với khoảng chờ tăng dần 5, 10, 20, 40... phút, tối đa 8 lần. Trạng thái lưu ở Redis `notification:dlq:<eventId>` (hết hạn sau 7 ngày); `EventRouter` vẫn chặn gửi trùng theo `eventId`.
- **SMTP không treo:** timeout kết nối 10 giây, chào 10 giây, chờ dữ liệu 20 giây.
- **Giao diện email xác nhận** theo màu và font của Tripflix: nhãn "Đã thanh toán", ô mã xác nhận, nhãn loại mục (khách sạn, vé máy bay), hành khách, tổng tiền, nút "Xem đơn đặt chỗ". Bố cục bảng, style viết trong thẻ để hiển thị được trên Gmail, Outlook.
- **Thông tin liên hệ người đặt** (tên, số điện thoại, email) trong email. Sự kiện `commerce.order.paid` thêm trường `contactPhone` (không bắt buộc, sự kiện cũ vẫn đọc được); commerce điền trường này khi đơn thanh toán xong.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| SES lỗi vài chục phút vẫn không mất mail | Có | `dead-letter-replay.spec.ts`: gửi lại sự kiện đến hạn, chờ theo khoảng tăng dần, dừng sau số lần tối đa, bỏ qua group khác và dữ liệu hỏng |
| SMTP có timeout | Có | `mailer.ts` truyền `connectionTimeout`, `greetingTimeout`, `socketTimeout` |
| Email đẹp theo phong cách dự án, vẫn chống chèn HTML | Có | `order-confirmation.email.spec.ts`; ảnh mail mẫu trong PR |
| Email có tên, số điện thoại, email người đặt | Có | `order-confirmation.email.spec.ts`; `checkout.int.spec.ts` kiểm `contactPhone` trong sự kiện |

## Kết quả kiểm tra
`pnpm turbo run lint typecheck test build --filter=@tripflix/notification-service --filter=@tripflix/contracts --filter=@tripflix/core-api`:
- notification-service: 49 test pass; contracts: 4 test pass; lint, typecheck, build pass.
- core-api: 665 pass, 2 lỗi ở `content/social` (giới hạn 2.000 ký tự bình luận). Nhánh này không sửa `content`; lỗi có sẵn, đã báo chủ phần (Thành).
- `pnpm contracts:build`: cập nhật `contracts/events/commerce.order.paid.v1.schema.json`.
- Chưa chạy `checkout.int.spec.ts` (cần Docker) và chưa thử gửi thật khi tắt rồi bật SMTP.

## Cách kiểm lại
1. Chạy stack local, đặt và thanh toán một đơn có nhập email và số điện thoại; mở Mailpit `http://localhost:8025` xem email.
2. Thử gửi lại: dừng Mailpit, thanh toán một đơn, chờ hơn 10 phút cho sự kiện vào `stream:dead-letter`, bật lại Mailpit; trong vòng khoảng 5 phút email được gửi.

## Ảnh / video
- Ảnh mail mẫu đính trong PR.

## Ảnh hưởng tới phần của người khác
- Có: `apps/notification-service` (chủ Dũng): thêm job, biến môi trường, timeout SMTP, đổi giao diện email xác nhận do Thắng viết. `libs/contracts` (chủ Dũng): chỉ thêm trường không bắt buộc. Cần Dũng duyệt PR.
