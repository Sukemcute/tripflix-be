# TF057 — Quên và đặt lại mật khẩu, email qua notification-service

- Notion: <dán link task TF057> · Nhánh: `dung/TF057-password-reset` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **`libs/event-bus`**: `RedisStreamsConsumer` đọc theo consumer group (`XGROUP CREATE … MKSTREAM`, `XREADGROUP BLOCK`), xử lý xong mới `XACK`, nhận lại việc treo quá 60 giây bằng `XAUTOCLAIM`, giao quá 5 lần thì chuyển sang `stream:dead-letter`.
- **`notification-service`**:
  - Consumer group `notification` nghe `stream:core.access`, `stream:core.content`, `stream:core.commerce`; tắt được bằng `NOTIFICATION_CONSUMER_ENABLED=false`.
  - Loại trùng theo `eventId` (Redis `notification:processed:<eventId>`, 7 ngày).
  - `access.password_reset_requested` → email tiếng Việt qua `nodemailer` (`SMTP_URL`, `MAIL_FROM`; dev là Mailpit). Sự kiện khác ghi log "Đã nhận sự kiện" (walking skeleton docs/11 §8 bước 7).
- **`access`**:
  - Bảng `password_resets` (migration mới `20261105031712_add_password_resets`): chỉ lưu SHA-256 của token, `expires_at` 30 phút, `used_at`.
  - `POST /api/auth/password/forgot { email }`: luôn `202` cùng một câu. Tài khoản đang hoạt động: trong một transaction xoá link cũ chưa dùng, lưu token mới, ghi `audit_logs`, ghi outbox `access.password_reset_requested` v1 `{ userId, email, displayName, resetUrl, expiresAt }`. Giới hạn 3 lần mỗi giờ theo email, 20 lần theo IP (`429`), đếm trước khi tra email nên không lộ email nào có tài khoản.
  - `POST /api/auth/password/reset { token, newPassword }`: `204`; đánh dấu đã dùng bằng một lệnh `UPDATE` có điều kiện (hai request cùng token chỉ một cái thắng), đổi mật khẩu, xoá mọi phiên, chặn `sid`. Sai, đã dùng, hết hạn hoặc tài khoản bị khoá: `400` cùng một câu.
  - Biến `AUTH_PASSWORD_RESET_URL` (mặc định `http://localhost:3100/dat-lai-mat-khau`). Job dọn xoá thêm token đặt lại đã hết hạn.
  - Bộ đếm `ActionRateLimiter` (Redis `INCR` + `EXPIRE NX`, bản bộ nhớ cho E2E).
- README `access`: API, bảng, sự kiện, mục "Quên mật khẩu (TF057)".
- Thư viện mới: `nodemailer`, `@types/nodemailer` (đã duyệt trong kế hoạch). Không thêm gì khác.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Quên mật khẩu → email hiện trong Mailpit | Có | Kiểm tay (1)–(3): email tới sau khoảng 1 giây, tiêu đề "Đặt lại mật khẩu Tripflix", link trỏ về trang web |
| Link đặt lại dùng được một lần, dùng lại thì `400` | Có | `password-reset.e2e.spec.ts`; `drizzle-access.store.int.spec.ts > 10 request cùng dùng một token…`; kiểm tay (4), (7) |
| Phiên cũ bị thu hồi | Có | `password-reset.e2e.spec.ts > đặt lại: 204, mọi phiên bị thu hồi…`; kiểm tay (5) |
| Test DB thật cho consumer: xử lý xong mới `XACK`, lỗi 5 lần thì vào dead-letter | Có | `libs/event-bus/src/consumer.int.spec.ts` (6 ca trên Redis thật); `notification-consumer.int.spec.ts` |
| Email không có tài khoản: cùng phản hồi | Có | `password-reset.e2e.spec.ts`; kiểm tay (8) |

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2, sau khi gộp `develop` mới nhất:

```
pnpm lint          → 22/22 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 22/22 task pass
pnpm test          → 295 test pass, 0 fail (core-api 226: thêm 6 E2E quên mật khẩu, 2 unit; notification-service 9)
pnpm test:int      → 37 test pass, 0 fail (core-api 23: thêm 2 ca password_resets, 2 ca bộ đếm Redis;
                     event-bus 6, notification-service 1, idempotency 4, testing 3)
pnpm build         → 13/13 task pass
pnpm contracts:build → thêm contracts/events/access.password_reset_requested.v1.schema.json,
                     OpenAPI thêm POST /api/auth/password/forgot, /reset
pnpm db:migrate    → access: đã migrate (bảng password_resets)
```

Kiểm tay cả luồng thật: core-api → relay → `stream:core.access` → `notification-service` → Mailpit: **8/8 PASS**.

```
(1) quên mật khẩu → 202 "Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu"
(2) email tới Mailpit qua outbox → stream → notification-service (1 email sau 1.0 giây)
(3) email tiếng Việt, đúng người nhận, link http://localhost:3100/dat-lai-mat-khau?token=…
(4) đặt lại bằng link trong email → 204
(5) phiên cũ bị đăng xuất → 401
(6) mật khẩu cũ → 401, mật khẩu mới → 200
(7) dùng lại link → 400 "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn"
(8) email không có tài khoản → cùng 202, cùng câu, không có email
```

Sau khi chạy: `XINFO GROUPS stream:core.access` có group `notification`, `pending 0`, `lag 0`; `notification-service` ghi "Đã nhận sự kiện" cho các sự kiện access cũ (`registered`, `role_changed`, `locked`, `unlocked`) và "Đã xử lý sự kiện" cho email; không có dòng lỗi ở cả hai service.

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. Chạy `node dist/main.js` trong `apps/core-api` và `apps/notification-service` (biến môi trường như `.env.example`).
3. `POST /api/auth/password/forgot` trên Swagger `http://localhost:3000/docs`, mở Mailpit `http://localhost:8025`, lấy `token` trên link, gọi `POST /api/auth/password/reset`.
4. `pnpm test && pnpm test:int`.

## Ảnh / video
- Không đổi giao diện. Trang `dat-lai-mat-khau` của web do Thành làm.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác (`libs/`, `access`, `notification-service`, `deploy/`, `contracts/` đều thuộc Dũng).
- `contracts/`: chỉ thêm endpoint và sự kiện. Thành làm trang `/dat-lai-mat-khau` đọc `?token=` rồi gọi `POST /api/auth/password/reset`.
