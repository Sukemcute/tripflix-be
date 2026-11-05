# TF05B — Email chào mừng khi tạo tài khoản

- Notion: <dán link task TF05B> · Nhánh: `dung/TF05B-email-chao-mung` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- Sự kiện mới `access.user.welcome_email_requested` v1 `{ userId, email, displayName, provider }` (`provider`: `password` hoặc `google`). Có email vì `notification-service` cần người nhận (docs/10 §3.5); chỉ `notification-service` dùng. `access.user.registered` giữ nguyên, vẫn không có email.
- `access`: ghi sự kiện trong `insertMember`, cùng transaction với tạo tài khoản và `access.user.registered`. Áp cho cả đăng ký bằng mật khẩu và lần đầu đăng nhập Google. Đăng nhập lại, liên kết Google vào tài khoản có sẵn, đăng ký trùng email (rollback) thì không có sự kiện.
- `notification-service`: email "Chào mừng bạn đến với Tripflix" (bản chữ và HTML, style viết thẳng trong thẻ, chống chèn HTML), nút "Khám phá ngay" mở `WEB_APP_URL` (mặc định `http://localhost:3100`). Tài khoản tạo bằng Google có thêm câu hướng dẫn dùng "Quên mật khẩu" để tạo mật khẩu. Chống gửi trùng theo `eventId` như các email khác.
- Biến `WEB_APP_URL` trong `.env.example`, `deploy/compose.yaml`. README `access` (bảng sự kiện) và README mới cho `notification-service`.
- Không thêm thư viện, không có migration.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đăng ký bằng Google nhận email chào mừng | Có | `google-login.e2e.spec.ts > email chào mừng…` (1 sự kiện `provider: google`); `event-router.spec.ts` (bản Google) |
| Đăng ký bằng email cũng nhận email chào mừng | Có | E2E như trên (`provider: password`); kiểm thật (1)–(4) |
| Đăng nhập lại không gửi lại | Có | E2E; kiểm thật (5) |
| Không gửi khi tạo tài khoản lỗi | Có | E2E đăng ký trùng; `auth.use-cases.int.spec.ts > ghi outbox lỗi thì rollback cả user` (0 sự kiện) |

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → 23/23 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 23/23 task pass
pnpm test          → core-api 354, notification-service 12 (thêm 3), auth 18, outbox 9, idempotency 7,
                     storage 18, db 4, config 2, contracts 2: tất cả pass.
                     video-worker 48/49: ffmpeg.spec.ts đỏ trên Windows do dấu \ của đường dẫn (có từ trước,
                     không thuộc PR này, đã báo Phong); CI Linux xanh.
pnpm test:int      → core-api 76, event-bus 6, video-worker 6, idempotency 4, testing 3, notification-service 1: pass
pnpm build         → 13/13 task pass
pnpm contracts:build → thêm contracts/events/access.user.welcome_email_requested.v1.schema.json; OpenAPI không đổi
```

Sửa test có sẵn của Dũng cho đúng hành vi mới (không nới lỏng): `auth.e2e.spec.ts` kiểm đúng 2 sự kiện sau đăng ký theo thứ tự `registered`, `welcome_email_requested`; `auth.use-cases.int.spec.ts` đếm 2 dòng outbox khi commit, vẫn 0 khi rollback.

Kiểm thật: web `:3100` → gateway → core-api → outbox → `stream:core.access` → `notification-service` → Mailpit: **5/5 PASS**.

```
(1) đăng ký trên web xong vào /account
(2) email chào mừng tới Mailpit sau 1,3 giây
(3) tiêu đề "Chào mừng bạn đến với Tripflix", đúng người nhận
(4) nội dung có tên người dùng, nút mở http://localhost:3100
(5) đăng nhập lại: không có email chào mừng thứ hai
```

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. Chạy `node dist/main.js` trong `apps/core-api` và `apps/notification-service`.
3. Đăng ký một tài khoản (web hoặc `POST /api/auth/register`), mở Mailpit `http://localhost:8025`.

## Ảnh / video
- Ảnh email chào mừng đính kèm trong PR, không commit ảnh vào repo.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác (`access`, `notification-service`, `libs/contracts`, `deploy/` thuộc Dũng).
- `contracts/`: chỉ thêm sự kiện. Module khác không cần làm gì; chỉ `notification-service` nghe sự kiện mới.
