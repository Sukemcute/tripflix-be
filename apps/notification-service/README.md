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
| `access.registration_code_requested` v1 | Email "Mã xác thực đăng ký Tripflix". Mã gồm 8 chữ số, hiệu lực 10 phút |
| `access.registration_attempted_existing` v1 | Email "Email này đã có tài khoản Tripflix", nút "Đăng nhập" mở `WEB_APP_URL/login`, kèm link `WEB_APP_URL/forgot-password` (đặt lại hoặc tạo mật khẩu cho tài khoản Google) |
| `access.email_verification_requested` v1 (TF05D) | Email chứa link xác thực 24 giờ cho tài khoản cũ. Vẫn nhận sự kiện `reason: "signup"` còn tồn từ bản trước |
| `access.user.locked` v1, `access.user.role_changed` v1 (TF26A) | Ngắt mọi kết nối `/ws` của người đó ở mọi replica (access đã thu hồi mọi phiên) |
| Sự kiện khác | Ghi log "Đã nhận sự kiện" |

## WebSocket `/ws` (TF26A)

Socket.IO, chỉ transport `websocket` (không long-polling, nên nhiều replica không cần sticky session). Redis adapter (pub/sub, hai kết nối riêng) để replica nào phát thì socket ở replica khác cũng nhận. Code ở `src/realtime/`.

```ts
import { io } from 'socket.io-client';

const socket = io(GATEWAY_URL, {
  path: '/ws',
  transports: ['websocket'],
  // Hàm: mỗi lần kết nối lại đều lấy access token mới nhất.
  auth: (cb) => cb({ token: getAccessToken() }),
});
socket.on('connect_error', (err) => {
  // err.data.code: 'unauthorized' → làm mới token rồi socket.connect(); 'unavailable' → thử lại sau.
});
socket.on('auth.expired', async () => {
  await refreshAccessToken(); // server ngắt ngay sau sự kiện này
  socket.connect();
});
socket.on('connect', () => {
  // Kết nối lại thì gọi lại API để lấy phần đã lỡ: socket chỉ báo "có mới", không lưu thông báo.
});
```

- **Bắt tay:** kiểm access token như `AccessTokenGuard` của HTTP (chữ ký qua JWKS, `iss`, `aud`, `exp`) và sid chưa bị thu hồi. Thiếu hoặc sai thì `connect_error` với `data.code = 'unauthorized'`; Redis hoặc JWKS lỗi thì `'unavailable'` (không cho qua khi chưa kiểm được phiên).
- **Room:** server tự cho socket vào `user:<userId>` và `sid:<sid>` lấy từ token. Không có `@SubscribeMessage` nào: client gửi gì lên cũng không vào được room của người khác.
- **Token hết hạn khi đang mở:** tới `exp` server gửi `auth.expired` rồi ngắt (`io server disconnect`); client làm mới token và gọi `socket.connect()`.
- **Gửi từ code:** `RealtimeService.emitToUser(userId, event, data)`, `disconnectUser(userId)`, `disconnectSession(sid)`.
- **`/health`:** có thêm `checks.realtime`, `false` khi kết nối pub/sub của adapter đang mất (lúc đó replica này phát không tới socket ở replica khác).

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `SMTP_URL` | `smtp://localhost:1025` | Dev là Mailpit, xem email ở http://localhost:8025. Production bắt buộc (SMTP của Amazon SES, `deploy/SERVER.md` Giai đoạn 4); để trống hay vẫn là Mailpit thì service dừng lúc khởi động |
| `MAIL_FROM` | `Tripflix <no-reply@tripflix.local>` | |
| `WEB_APP_URL` | `http://localhost:3100` | Trang web mở từ email chào mừng |
| `NOTIFICATION_CONSUMER_ENABLED` | `true` | Tắt khi chạy test không có Redis |
| `NOTIFICATION_CONSUMER_NAME` | hostname | Mỗi replica một tên |

Chưa có: hộp thư in-app (`inbox`, `/notifications`), push qua Expo, gom thông báo, tuỳ chọn người dùng.
