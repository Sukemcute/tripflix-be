# TF059 — Đăng nhập Google và gộp gu khách X-Anon-Id

- Notion: <dán link task TF059> · Nhánh: `dung/TF059-google-guest-merge` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- Migration mới `20261105034043_add_user_identities`:
  - Bảng `user_identities`: khoá chính `(provider, subject)`, `user_id` (xoá người dùng thì xoá theo), `email`, `created_at`; `ck_user_identities_provider` chỉ nhận `google`.
  - `users.password_hash` cho phép trống: tài khoản chỉ có Google. Đăng nhập bằng mật khẩu vào tài khoản này luôn nhận lỗi chung (vẫn chạy argon2 giả để không lộ thời gian); đổi mật khẩu nhận `400`; muốn có mật khẩu thì dùng "quên mật khẩu".
- `POST /api/auth/google { idToken, deviceName? }`:
  - Kiểm bằng `jose` qua JWKS của Google (`GOOGLE_JWKS_URL`): RS256, `iss` là `accounts.google.com`, `aud` thuộc `GOOGLE_CLIENT_IDS`, `exp`, `email_verified = true`.
  - Đã liên kết thì đăng nhập; chưa liên kết nhưng trùng email thì liên kết; chưa có tài khoản thì tạo `member` (phát `access.user.registered`). Tài khoản bị khoá: `401`, không liên kết thêm. Hai request lần đầu cùng lúc: request thua rollback, không tạo trùng.
  - Sai bất kỳ điều kiện nào: `401 "Đăng nhập bằng Google không thành công"`. Chưa đặt `GOOGLE_CLIENT_IDS`: `503`.
  - Chế độ web (`X-Tripflix-Client: web`, cookie, kiểm `Origin`) giống `/auth/login`.
- `X-Anon-Id`: header UUID. Đăng ký, đăng nhập, đăng nhập Google thành công thì ghi outbox `access.user.guest_merged` v1 `{ anonId, userId }` trong cùng transaction, đúng một sự kiện mỗi lần. Header sai dạng hoặc đăng nhập lỗi: không có sự kiện.
- Audit: `auth.google_linked`; `auth.register`, `auth.login` có `meta.provider` (`password` hoặc `google`).
- Biến mới `GOOGLE_CLIENT_IDS` (mặc định trống, tắt), `GOOGLE_JWKS_URL`. Thêm vào `.env.example`, `deploy/compose.yaml`.
- README `access`: API, bảng, sự kiện, mục "Đăng nhập Google và khách vãng lai".
- Không thêm thư viện.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Lần đầu đăng nhập Google tạo `member`, lần sau vào đúng tài khoản đó | Có | `google-login.e2e.spec.ts > lần đầu tạo member…` (kể cả token của client Android); kiểm tay (1)–(3) |
| Token sai `aud`, hết hạn hoặc `email_verified=false` nhận `401` | Có | `google-login.e2e.spec.ts > token sai aud, sai iss, hết hạn, sai chữ ký, email chưa xác minh…`; kiểm tay (4), (5) |
| Có `X-Anon-Id` thì có đúng 1 sự kiện `guest_merged` | Có | `google-login.e2e.spec.ts > X-Anon-Id: đúng một…` (đăng ký, đăng nhập, Google), `> X-Anon-Id sai dạng…`; trong database sau kiểm tay: đúng 1 sự kiện, đã gửi sang `stream:core.access` |
| Test bằng JWKS giả, không cần Google thật | Có | Server JWKS giả bằng `node:http` trong E2E và khi kiểm tay |

## Kết quả kiểm tra
Chạy ngày 2026-11-05, Node 24.22.1, pnpm 10.32.1, Docker Desktop 28.3.2:

```
pnpm lint          → 22/22 task pass; "Ranh giới module: không có vi phạm."
pnpm typecheck     → 22/22 task pass
pnpm test          → 306 test pass, 0 fail (core-api 237: thêm 8 E2E Google, X-Anon-Id, 3 unit kiểm ID token)
pnpm test:int      → 38 test pass, 0 fail (core-api 24: thêm 1 ca user_identities, password_hash trống;
                     event-bus 6, idempotency 4, testing 3, notification-service 1)
pnpm build         → 13/13 task pass
pnpm contracts:build → thêm contracts/events/access.user.guest_merged.v1.schema.json, OpenAPI thêm POST /api/auth/google
pnpm db:migrate    → access: đã migrate
```

Kiểm tay trên `core-api` thật với Postgres, Redis local, `GOOGLE_CLIENT_IDS=tripflix-web-test`, `GOOGLE_JWKS_URL` trỏ vào server JWKS giả do script bật: **6/6 PASS**.

```
(1) đăng nhập Google lần đầu (có X-Anon-Id) → 200, tạo member
(2) /auth/me: email, tên lấy từ Google ("Khang Google")
(3) lần sau vào đúng tài khoản đó
(4) token sai aud → 401 "Đăng nhập bằng Google không thành công"
(5) email_verified=false → 401
(6) tài khoản chỉ có Google đăng nhập bằng mật khẩu → 401 "Email hoặc mật khẩu không đúng"
```

Trong database: `user_identities` có dòng `google` cho người thử; `users.password_hash` trống; `outbox_events` có `access.user.registered` và đúng một `access.user.guest_merged` với `anonId` đã gửi, cả hai đã có `published_at` và nằm trong `stream:core.access`; `audit_logs` có `auth.register`, `auth.login` với `provider: google`.

## Việc cần khi chạy thật
- Tạo OAuth Client ID (Web, Android, iOS) trên Google Cloud Console, đặt vào `GOOGLE_CLIENT_IDS` cách nhau bởi dấu phẩy. Không chặn PR này.

## Cách kiểm lại
1. `pnpm install && pnpm stack:infra && pnpm build && pnpm db:migrate`.
2. `pnpm test && pnpm test:int` (E2E tự bật server JWKS giả).

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác.
- `contracts/`: chỉ thêm endpoint và sự kiện. Duy (`discovery`), Phong (feed) nghe `access.user.guest_merged` để gộp gu; Trang (mobile), Thành (web) gửi `X-Anon-Id` và gọi `POST /api/auth/google`.
