# Module `access`

- Chủ: Dũng (backup Duy)
- Database: `core`, schema `access`, user Postgres `tf_access`
- Thiết kế: docs/architecture/10 §3.10

## Phần con

| Phần | Trạng thái |
|---|---|
| `auth/`: đăng ký, đăng nhập, làm mới xoay vòng, đăng xuất, JWKS | Có (TF05) |
| `staff/`: API `/admin/*` cho nhân viên | Có `GET /admin/me`, `GET /admin/staff`. Cấp quyền, khoá tài khoản làm sau |
| Đăng nhập Google, quên mật khẩu, token service-to-service | Chưa làm |

## API

| API | Ai gọi | Kết quả |
|---|---|---|
| `POST /api/auth/register` `{ email, password, displayName }` | Ai cũng được | `201` người dùng. Luôn là `member`, trường `role` gửi lên bị bỏ qua. Email trùng: `409` |
| `POST /api/auth/login` `{ email, password, deviceName? }` | Ai cũng được | `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }`. Sai email hay mật khẩu đều `401 "Email hoặc mật khẩu không đúng"` |
| `POST /api/auth/refresh` `{ refreshToken }` | Có refresh token | Cặp token mới, token cũ hết dùng được |
| `POST /api/auth/logout` | Bearer access token | `204`. Xoá phiên, access token của phiên bị từ chối ngay |
| `GET /api/auth/me` | Bearer access token | Người dùng đang đăng nhập |
| `GET /.well-known/jwks.json` | Gateway, service khác | Khoá công khai ES256. Nằm ngoài `/api` |
| `GET /api/admin/me` | `moderator`, `superadmin` | Nhân viên đang đăng nhập |
| `GET /api/admin/staff` | `superadmin` | Danh sách tài khoản nhân viên |

Chưa đăng nhập: `401`. Sai vai trò: `403`. Module khác chặn quyền bằng `@Roles(...)` của `@tripflix/auth` (xem `libs/auth/README.md`).

## Token

| | Cách làm |
|---|---|
| Access token | JWT ES256 ký bằng `jose`, sống 15 phút. Claim `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud`; header có `kid` |
| Refresh token | Chuỗi ngẫu nhiên 256 bit. Database chỉ lưu SHA-256 của nó trong `sessions`. Sống 30 ngày, tính lại mỗi lần làm mới |
| Xoay vòng | Mỗi lần `/auth/refresh` cấp refresh token mới; token vừa dùng thành `previous_token_hash` |
| Dùng lại token cũ | Trong 10 giây sau lần xoay: vẫn cấp cặp mới (phòng mạng làm mất phản hồi). Quá 10 giây: xoá phiên, chặn `sid`, ghi `auth.refresh_reused`, trả `401` |
| Thu hồi ngay | Đăng xuất hoặc dùng lại token cũ: ghi `auth:revoked-sid:<sid>` vào Redis tới khi access token hết hạn. Mọi service dùng `@tripflix/auth` đều kiểm khoá này |
| Đăng nhập sai | Sai 5 lần theo email hoặc 20 lần theo IP trong 15 phút: `429` kèm `Retry-After`. Email không tồn tại vẫn chạy argon2 để không lộ email nào có tài khoản |
| Mật khẩu | argon2id, 8–128 ký tự |

Giới hạn: chỉ phát hiện dùng lại token **liền trước**. Token cũ hơn bị từ chối `401` nhưng không thu hồi phiên.

## Bảng

| Bảng | Ghi chú |
|---|---|
| `users` | `email` chữ thường, duy nhất. `role` thuộc `member`, `moderator`, `superadmin`. `status` thuộc `active`, `locked` |
| `sessions` | `id` là `sid`. `refresh_token_hash`, `previous_token_hash`, `rotated_at`, `expires_at`, thiết bị, IP |
| `outbox_events` | Sự kiện chờ gửi (`libs/outbox`) |
| `audit_logs` | Chỉ thêm: `auth.register`, `auth.login`, `auth.login_failed`, `auth.refresh`, `auth.refresh_reused`, `auth.logout` |

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate access`. Không sửa migration đã merge.

## Sự kiện phát ra

Ghi vào `access.outbox_events` trong cùng transaction, relay gửi sang `stream:core.access` khi `APP_ROLE` là `worker` hoặc `all` (`libs/outbox`).

| Sự kiện | Khi nào | Payload (`libs/contracts`) |
|---|---|---|
| `access.user.registered` v1 | Đăng ký thành công | `AccessUserRegisteredV1Schema`: `{ userId, displayName }`, không có email |

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `AUTH_JWT_PRIVATE_KEY` | trống | PEM PKCS8 ES256. Trống ở dev, test: tự sinh khoá tạm, token mất hiệu lực khi khởi động lại. Bắt buộc ở production. Sinh bằng `pnpm --filter @tripflix/core-api auth:keygen` |
| `AUTH_JWT_KID` | thumbprint của khoá | |
| `AUTH_JWT_ISSUER` | `tripflix-core` | Service kiểm token phải đặt giống |
| `AUTH_JWT_AUDIENCE` | `tripflix` | Service kiểm token phải đặt giống |
| `SEED_PASSWORD` | | Chỉ cho `pnpm db:seed` |

## Chạy trên máy

```sh
pnpm stack:infra
pnpm db:migrate
pnpm db:seed      # superadmin@, moderator@, member@tripflix.local, mật khẩu SEED_PASSWORD
```

Máy đã chạy `pnpm stack:infra` **trước** commit `fix(deploy): cấp quyền CREATE...` thì chạy một lần, không mất dữ liệu:

```sh
docker exec tripflix-postgres-1 psql -U postgres -c "GRANT CREATE ON DATABASE core TO tf_access, tf_content, tf_discovery, tf_analytics" -c "GRANT CREATE ON DATABASE commerce TO tf_commerce" -c "GRANT CREATE ON DATABASE notification TO tf_notification"
```

## Khuôn thư mục

Mỗi phần con (`auth/`, `staff/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, transaction access, ghi audit_logs
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, Redis, argon2, jose; infra/memory/ cho test
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

`@Transactional('access')` chưa có trong `libs/db`, nên use case đang gọi `AccessStore.transaction()` (bọc `db.transaction()` của Drizzle). Đổi sang decorator khi `libs/db` có.
