# TF05 — Xác thực đăng nhập bằng JWT

- Notion: <dán link task TF05> · Nhánh: `dung/TF05-xac-thuc-dang-nhap-bang-jwt` · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- `libs/auth` (mới): `createAccessTokenVerifier` kiểm JWT ES256 qua JWKS (iss, aud, exp, đủ claim), `AccessTokenGuard`, `@Roles(...)` + `RolesGuard`, `@CurrentUser()`, danh sách chặn `sid` trong Redis dùng chung cho mọi service.
- Module `access`: bảng `users`, `sessions`, `audit_logs` và migration đầu; API `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/.well-known/jwks.json`, `/admin/me`, `/admin/staff`.
- Refresh token xoay vòng, chỉ lưu SHA-256; dùng lại token cũ quá 10 giây thì thu hồi cả phiên (trong 10 giây vẫn nhận, phòng mạng yếu làm mất phản hồi).
- Chặn đăng nhập sai: 5 lần theo email hoặc 20 lần theo IP trong 15 phút thì `429`.
- `pnpm db:seed`: tài khoản mẫu `superadmin@`, `moderator@`, `member@tripflix.local`. `auth:keygen`: sinh khoá ES256 cho staging.
- `notification-service`: kiểm access token qua `JWKS_URL`, `GET /notifications/me`.
- Sửa lỗi có sẵn ở `deploy/postgres/init/02-roles-schemas.sql`: cấp `CREATE` trên database cho user từng module, vì Drizzle luôn chạy `CREATE SCHEMA IF NOT EXISTS` nên `pnpm db:migrate` lỗi ở mọi module.
- `deploy/compose.yaml`: `JWKS_URL`, biến khoá ký, service `migrate` chạy thêm `db:seed`.
- Đã merge `origin/develop` (có RULES §4.1 mới) và đặt tên theo quy ước: constraint `uq_`, `idx_`, `ck_`, `fk_<table>_<...>`; bảng số nhiều `audit_logs` (docs/10 còn ghi `audit_log`); Zod schema `RegisterRequestSchema`...; boolean `is`/`has`; hàm bắt đầu bằng động từ. Migration đầu được sinh lại (chưa merge nên không vi phạm quy tắc "không sửa migration đã merge").

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| `POST /auth/register` và `POST /auth/login` chạy được | Có | E2E `access E2E > đăng ký → đăng nhập → ...`; kiểm tay (1), (2) |
| Mật khẩu băm bằng argon2 | Có | E2E kiểm `passwordHash` bắt đầu `$argon2id$`; DB: `access.users.password_hash` = `$argon2id$v=19$m=65536,t=3,p=4...` |
| Sai email hoặc mật khẩu đều trả cùng một thông báo lỗi | Có | E2E `sai email hay sai mật khẩu đều cùng một thông báo`; unit `AuthUseCases.login`; kiểm tay (17) |
| Đăng nhập sai quá số lần cho phép thì bị chặn tạm thời | Có | E2E: lần 6 trả `429`, hết 15 phút đăng nhập lại được; kiểm tay (18): `429`, `Retry-After: 900` |
| JWT ký ES256 bằng jose, sống 15 phút | Có | E2E `access token ES256 có đủ claim...` (`exp - iat = 900`, header `alg: ES256`); kiểm tay (3), (4) |
| Có đủ claim `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud` | Có | Như trên: E2E so đúng 7 claim |
| `GET /auth/me` trả đúng người dùng từ token | Có | E2E luồng chính; kiểm tay (5) |
| `POST /auth/refresh` cấp cặp token mới và vô hiệu refresh token cũ | Có | Unit `AuthUseCases.refresh > xoay vòng`; E2E; kiểm tay (9) |
| Dùng lại refresh token cũ thì thu hồi cả phiên | Có | Unit `dùng lại token cũ sau 10 giây: thu hồi cả phiên, chặn sid, ghi audit`; unit `decideRefresh`; E2E `dùng lại refresh token cũ sau 10 giây`; kiểm tay (11)–(13) |
| Refresh token chỉ lưu bản băm trong `access.sessions`, sống 30 ngày | Có | Unit kiểm `refreshTokenHash = sha256(token)` và không chứa token gốc; DB: `length(refresh_token_hash) = 64`, `expires_at - created_at = 30 days` |
| `POST /auth/logout` xoá phiên | Có | E2E kiểm phiên bị xoá khỏi store; kiểm tay (14) |
| `sid` vào danh sách chặn Redis, access token cũ bị từ chối ngay | Có | E2E: sau logout `/auth/me` trả `401`; unit `AccessTokenGuard > trả 401 khi sid đã bị chặn`; kiểm tay (15): core `401`, notification `401`; Redis có `auth:revoked-sid:<sid>` |
| Guard `@Roles(...)` trong `libs/auth` áp cho API `/admin/*` | Có | `AdminController` gắn `@Roles('moderator', 'superadmin')`; unit `RolesGuard` |
| moderator và superadmin chỉ gọi được đúng API theo vai trò | Có | E2E `phân quyền /admin/*`; kiểm tay (22)–(27) |
| Tài khoản member gọi `/admin/*` nhận 403 | Có | E2E; kiểm tay (22), (23) |
| Có sẵn tài khoản mẫu cho cả 3 vai trò | Có | `pnpm db:seed` (chạy 2 lần, lần 2 "đã có, giữ nguyên"); kiểm tay (19)–(21) |
| `GET /.well-known/jwks.json` trả khoá công khai | Có | E2E kiểm khoá EC P-256, không có `d`, kiểm được token vừa cấp; kiểm tay (6) |
| `libs/auth` lấy JWKS để kiểm token, kiểm đủ iss, aud, exp | Có | `libs/auth/src/verifier.spec.ts`: token đúng, sai chữ ký, hết hạn, sai iss, sai aud, sai thuật toán, thiếu claim |
| Chứng minh bằng notification-service: nhận token thật, từ chối token sai chữ ký hoặc hết hạn | Có | `apps/notification-service/src/me.e2e.spec.ts` (server JWKS qua HTTP thật); kiểm tay (7), (8) |
| Unit test cho xoay vòng refresh token và dùng lại token cũ | Có | `refresh-rotation.spec.ts` (5 test), `auth.use-cases.spec.ts` (5 test) |
| E2E Supertest: đăng ký → đăng nhập → /auth/me → làm mới → đăng xuất → token cũ bị từ chối | Có | `apps/core-api/src/modules/access/auth.e2e.spec.ts` |
| Có test chặn member vào `/admin/*` | Có | E2E `phân quyền /admin/*` |
| `pnpm turbo run lint typecheck test --affected` pass | Có | Xem "Kết quả kiểm tra" |
| Cập nhật `access/README.md` và `.env.example` (khoá ký, iss, aud) | Có | `apps/core-api/src/modules/access/README.md`, `apps/core-api/.env.example`, `apps/notification-service/.env.example`, `libs/auth/README.md` |
| Có file evidence | Có | File này |

## Kết quả kiểm tra
Chạy ngày 2026-11-04 trên Windows 11, Node 24.22.1, pnpm 10.32.1:

```
pnpm lint                                        → 15/15 task pass, 0 warning, 0 error; "Ranh giới module: không có vi phạm."
pnpm typecheck                                   → 15/15 task pass
pnpm test                                        → 40 test pass, 0 fail
                                                   @tripflix/auth 14, @tripflix/core-api 18, @tripflix/notification-service 4,
                                                   @tripflix/contracts 2, @tripflix/config 2
pnpm build                                       → 9/9 task pass
pnpm turbo run lint typecheck test --affected    → 15/15 task pass (scope: //, auth, core-api, notification-service)
pnpm contracts:build && git diff --exit-code contracts/ → không khác
```

Kiểm tay trên Postgres 17 + Redis 8.8 thật (`pnpm stack:infra`), core-api và notification-service chạy bằng `node dist/main.js`: **27/27 PASS**. Chạy 2 lần: trước và sau khi đổi tên theo RULES §4.1 (lần 2 trên bảng tạo từ migration mới, constraint `ck_users_email_lowercase`, `ck_users_role`, `ck_users_status`, `fk_sessions_user_id`, `uq_sessions_refresh_token_hash`, `uq_users_email`).

```
(1)  PASS  POST /api/auth/register trả 201, role luôn member
(2)  PASS  POST /api/auth/login trả 200
(3)  PASS  JWT ES256, đủ claim sub role sid iat exp iss aud
(4)  PASS  Access token sống 15 phút (exp-iat=900)
(5)  PASS  GET /api/auth/me trả đúng người dùng
(6)  PASS  GET /.well-known/jwks.json trả khoá công khai (không có d)
(7)  PASS  notification-service nhận token thật qua JWKS
(8)  PASS  notification-service từ chối token sai chữ ký
(9)  PASS  POST /api/auth/refresh cấp cặp mới
(10) PASS  Dùng lại token cũ trong 10 giây vẫn được nhận (mạng yếu)
(11) PASS  Dùng lại token cũ sau 10 giây: 401 "Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại"
(12) PASS  Token mới nhất của phiên bị thu hồi cũng hết dùng được
(13) PASS  Access token của phiên bị thu hồi bị từ chối ngay ở core và notification
(14) PASS  POST /api/auth/logout trả 204
(15) PASS  Sau đăng xuất, access token cũ bị từ chối ngay (core 401, noti 401)
(16) PASS  Sau đăng xuất, refresh token cũng bị từ chối
(17) PASS  Sai email và sai mật khẩu cùng một thông báo ("Email hoặc mật khẩu không đúng")
(18) PASS  Sai 5 lần thì lần 6 bị chặn 429, Retry-After 900 (kể cả đúng mật khẩu)
(19)–(21) PASS  Tài khoản mẫu member@, moderator@, superadmin@tripflix.local đăng nhập được
(22) PASS  member gọi /api/admin/me → 403        (23) PASS  member gọi /api/admin/staff → 403
(24) PASS  moderator gọi /api/admin/me → 200     (25) PASS  moderator gọi /api/admin/staff → 403
(26) PASS  superadmin gọi /api/admin/me → 200    (27) PASS  superadmin gọi /api/admin/staff → 200
```

Database sau khi kiểm: `access.audit_logs` có `auth.register` 1, `auth.login` 5, `auth.login_failed` 6, `auth.refresh` 2, `auth.refresh_reused` 1, `auth.logout` 1. Các bảng `access.*` thuộc `tf_access`. `tf_access` vẫn bị từ chối khi đọc, ghi schema `content` và khi kết nối database `commerce`.

## Cách kiểm lại
1. `pnpm install`, `pnpm stack:infra`. Máy đã có volume Postgres từ trước: chạy lệnh `GRANT CREATE ...` trong `apps/core-api/src/modules/access/README.md` một lần.
2. Chép `apps/core-api/.env.example` thành `apps/core-api/.env`, `apps/notification-service/.env.example` thành `apps/notification-service/.env`.
3. `pnpm build && pnpm db:migrate && pnpm db:seed`.
4. Chạy `node dist/main.js` trong `apps/core-api` và `apps/notification-service` (hoặc `pnpm dev`).
5. Đăng nhập `superadmin@tripflix.local` / `SEED_PASSWORD` qua Swagger `http://localhost:3000/docs`, gọi `/api/admin/staff`; đổi sang `member@tripflix.local` thì nhận `403`.
6. Test tự động: `pnpm lint && pnpm typecheck && pnpm test`.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Có, đều là cấu hình chung hoặc file sinh ra, chỉ **thêm**, không sửa hay xoá phần đang dùng:
  - `pnpm-workspace.yaml` (catalog thêm `jose`, `argon2`), `pnpm-lock.yaml`, `package.json` gốc (thêm `db:seed`): cấu hình chung, cần Tech Lead duyệt.
  - `contracts/openapi/core-api.json`: thêm endpoint auth, admin, jwks. FE (Thành, Trang) chạy `pnpm gen:api` để có client.
  - `deploy/postgres/init/02-roles-schemas.sql`: thêm `GRANT CREATE ON DATABASE` cho user của mọi module. Ai đã chạy `stack:infra` cần chạy GRANT một lần, không mất dữ liệu.
- Chưa kiểm: build image Docker `core-api` (mạng chậm). `argon2` dùng bản dựng sẵn `linux-x64` trong package, hợp với `node:24-slim`; pnpm báo "Ignored build scripts: argon2" là bình thường.
- Ngoài phạm vi: đăng nhập Google, quên mật khẩu, token service-to-service, `POST /admin/staff`, khoá tài khoản, gộp `X-Anon-Id`, kiểm JWT tại Traefik, cookie refresh token cho web, sự kiện outbox của access.
