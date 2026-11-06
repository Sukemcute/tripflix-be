# notification-service

- Phụ trách: Dũng (backup Duy)
- Cổng 3001; gateway chuyển `/notifications/*`, `/ws` về đây.
- Thiết kế: docs/architecture/10 §3.5.

## Nghe sự kiện

Consumer group `notification` đọc `stream:core.access`, `stream:core.content`, `stream:core.commerce` (`RedisStreamsConsumer` của `libs/event-bus`). Xử lý xong mới `XACK`; lỗi thì giao lại, quá 5 lần vào `stream:dead-letter`. Chống gửi trùng theo `eventId` (Redis `notification:processed:<eventId>`, 7 ngày).

| Sự kiện | Việc làm |
|---|---|
| `access.password_reset_requested` v1 | Email "Đặt lại mật khẩu Tripflix", link dùng một lần |
| `access.user.welcome_email_requested` v1 | Email "Chào mừng bạn đến với Tripflix", nút "Khám phá ngay" mở `WEB_APP_URL`; tài khoản tạo bằng Google có thêm cách tạo mật khẩu |
| `access.email_verification_requested` v1 (TF05D) | `reason: "signup"`: email "Chào mừng bạn đến với Tripflix, hãy xác nhận email" (gộp lời chào, không gửi email chào mừng riêng). `reason: "resend"`: email "Xác nhận email Tripflix của bạn". Nút "Xác nhận email" mở `verifyUrl`, link sống 24 giờ |
| Sự kiện khác | Ghi log "Đã nhận sự kiện" |

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `SMTP_URL` | `smtp://localhost:1025` | Dev là Mailpit, xem email ở http://localhost:8025. Production bắt buộc (SMTP của Amazon SES, `deploy/SERVER.md` Giai đoạn 4); để trống hay vẫn là Mailpit thì service dừng lúc khởi động |
| `MAIL_FROM` | `Tripflix <no-reply@tripflix.local>` | |
| `WEB_APP_URL` | `http://localhost:3100` | Trang web mở từ email chào mừng |
| `NOTIFICATION_CONSUMER_ENABLED` | `true` | Tắt khi chạy test không có Redis |
| `NOTIFICATION_CONSUMER_NAME` | hostname | Mỗi replica một tên |

Chưa có: hộp thư in-app (`inbox`, `/notifications`), WebSocket `/ws`, push qua Expo, gom thông báo, tuỳ chọn người dùng.
