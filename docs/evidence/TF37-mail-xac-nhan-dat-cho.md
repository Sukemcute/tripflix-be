# TF37: email xác nhận đặt chỗ

- Notion: chưa có link · Người làm: Thắng (dùng AI: có) · Ngày: 2026-11-09 · Nhánh: `thang/TF37-mail-xac-nhan-dat-cho`

## Đã làm
- Notification nhận `commerce.order.paid`, gửi email có mã xác nhận, các mục đã đặt và tổng tiền.
- Đơn không có email liên hệ thì chưa gửi, vì notification chưa tra được email tài khoản.

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/notification-service`: pass, 26/26.
- Chạy thật trên stack riêng, Mailpit:

| Bước | Kết quả |
|---|---|
| Tắt notification, đặt và thanh toán | checkout 201, guests 200, pay 200; không có mail |
| Bật lại notification | mail tới sau 5 giây |
| Chờ thêm 15 giây | vẫn đúng 1 mail |

## Cách kiểm lại
1. `pnpm stack:be`, seed, đăng nhập tài khoản member.
2. Dừng `notification-service`, đặt và thanh toán có email liên hệ.
3. Bật lại, xem Mailpit ở cổng 8025.

## Ảnh hưởng tới phần của người khác
- Có: `notification-service` (Dũng), chỉ thêm một nhánh xử lý.
