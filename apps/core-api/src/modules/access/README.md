# Module `access`

- Chủ: Dũng (backup Duy)
- Database: `core`, schema `access`, user Postgres `tf_access`
- Thiết kế: docs/architecture/10 §3.10

## Phần con

| Phần | Trạng thái |
|---|---|
| `auth/`: đăng ký, đăng nhập, làm mới xoay vòng, đăng xuất, JWKS | Có (TF05); cookie refresh token cho web, admin (TF056) |
| `account/`: tài khoản của tôi | Có (TF055): đổi tên, đổi mật khẩu, xem và thoát từng thiết bị, thoát mọi thiết bị |
| `staff/`: API `/admin/*` cho nhân viên | Có (TF054): tìm người dùng, cấp và thu hồi quyền kiểm duyệt viên, khoá và mở khoá tài khoản |
| `service/`: token service-to-service | Có (TF058): bảng `service_clients`, CLI tạo và vô hiệu hoá client, `POST /auth/service-token` |
| Đăng nhập Google, quên mật khẩu | Chưa làm |

## API

| API | Ai gọi | Kết quả |
|---|---|---|
| `POST /api/auth/register` `{ email, password, displayName }` | Ai cũng được | `201` người dùng. Luôn là `member`, trường `role` gửi lên bị bỏ qua. Email trùng: `409` |
| `POST /api/auth/login` `{ email, password, deviceName? }` | Ai cũng được | `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }`. Sai email hay mật khẩu đều `401 "Email hoặc mật khẩu không đúng"` |
| `POST /api/auth/refresh` `{ refreshToken }` | Có refresh token | Cặp token mới, token cũ hết dùng được. Web, admin để body trống, token đọc từ cookie (xem "Web, admin: refresh token trong cookie") |
| `POST /api/auth/logout` | Bearer access token | `204`. Xoá phiên, access token của phiên bị từ chối ngay. Có cookie thì xoá cookie |
| `GET /api/auth/me` | Bearer access token | Người dùng đang đăng nhập |
| `PATCH /api/auth/me` `{ displayName }` | Bearer access token | Người dùng sau khi đổi tên |
| `POST /api/auth/password/change` `{ currentPassword, newPassword }` | Bearer access token | `204`. Thiết bị khác bị đăng xuất, thiết bị đang gọi dùng tiếp. Sai mật khẩu hiện tại: `400` (không phải `401`, để client không tưởng token hết hạn) |
| `GET /api/auth/sessions` | Bearer access token | Thiết bị đang đăng nhập: `{ id, deviceName, userAgent, createdAt, lastUsedAt, isCurrent }`, dùng gần nhất trước |
| `DELETE /api/auth/sessions/{id}` | Bearer access token | `204`. Thoát thiết bị đó, token của nó nhận `401` ngay. Phiên không phải của mình: `404` |
| `POST /api/auth/logout-all` | Bearer access token | `204`. Thoát mọi thiết bị, kể cả thiết bị đang gọi. Có cookie thì xoá cookie |
| `GET /.well-known/jwks.json` | Gateway, service khác | Khoá công khai ES256. Nằm ngoài `/api` |
| `POST /api/auth/service-token` `{ clientId, clientSecret, audience }` | Service khác (không phải người dùng) | `{ accessToken, tokenType: "Bearer", expiresIn: 300 }`. Sai bất kỳ thông tin nào: `401 "Thông tin service không đúng"`. Xem "Token giữa các service" |
| `GET /api/admin/me` | `moderator`, `superadmin` | Nhân viên đang đăng nhập |
| `GET /api/admin/staff` | `superadmin` | Danh sách tài khoản nhân viên |
| `GET /api/admin/users?query=&page=` | `moderator`, `superadmin` | Tìm theo email, tên; 20 người mỗi trang. Moderator thấy email đã che (`kh***@example.com`) |
| `POST /api/admin/staff` `{ userId }` | `superadmin` | Cấp `moderator` |
| `DELETE /api/admin/staff/{userId}` | `superadmin` | Thu hồi về `member` |
| `POST /api/admin/users/{userId}/lock`, `/unlock` | `superadmin` | Khoá: không đăng nhập được. Mở khoá: đăng nhập lại được |

Chưa đăng nhập: `401`. Sai vai trò: `403`. Module khác chặn quyền bằng `@Roles(...)` của `@tripflix/auth` (xem `libs/auth/README.md`).

## Token

| | Cách làm |
|---|---|
| Access token | JWT ES256 ký bằng `jose`, sống 15 phút. Claim `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud`; header có `kid` |
| Refresh token | Chuỗi ngẫu nhiên 256 bit. Database chỉ lưu SHA-256 của nó trong `sessions`. Sống 30 ngày, tính lại mỗi lần làm mới |
| Xoay vòng | Mỗi lần `/auth/refresh` cấp refresh token mới; token vừa dùng thành `previous_token_hash` |
| Dùng lại token cũ | Trong 10 giây sau lần xoay: vẫn cấp cặp mới (phòng mạng làm mất phản hồi). Quá 10 giây: xoá phiên, chặn `sid`, ghi `auth.refresh_reused`, trả `401` |
| Thu hồi ngay | Đăng xuất, thoát thiết bị, đổi mật khẩu hoặc dùng lại token cũ: ghi `auth:revoked-sid:<sid>` vào Redis tới khi access token hết hạn. Mọi service dùng `@tripflix/auth` đều kiểm khoá này |
| Đăng nhập sai | Sai 5 lần theo email hoặc 20 lần theo IP trong 15 phút: `429` kèm `Retry-After`. Email không tồn tại vẫn chạy argon2 để không lộ email nào có tài khoản. Nhập sai mật khẩu hiện tại khi đổi mật khẩu cũng tính vào giới hạn này |
| Mật khẩu | argon2id, 8–128 ký tự |

Giới hạn: chỉ phát hiện dùng lại token **liền trước**. Token cũ hơn bị từ chối `401` nhưng không thu hồi phiên.

## Web, admin: refresh token trong cookie (TF056)

App mobile giữ refresh token trong `expo-secure-store`, gửi trong body như trên. Web, admin không để JavaScript cầm refresh token (docs/10 §3.10):

| | Cách làm |
|---|---|
| Bật chế độ web | Gửi header `X-Tripflix-Client: web` khi `login`, `refresh`, `logout`, `logout-all` |
| Cookie | `tripflix_refresh`: `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Max-Age` 30 ngày, `Secure` khi `NODE_ENV=production`. Body của `login`, `refresh` **không** có `refreshToken` |
| Làm mới | `POST /api/auth/refresh` body trống (hoặc không có body), trình duyệt tự gửi cookie. Lỗi (`401`) thì cookie bị xoá, web chuyển về trang đăng nhập |
| Đăng xuất | `logout`, `logout-all` xoá cookie |
| Chống CSRF | Mọi request ở chế độ web hoặc có dùng cookie phải có header `Origin` nằm trong `AUTH_WEB_ORIGINS`. Thiếu hoặc lạ: `403 "Nguồn gửi request không được phép"` |
| CORS | `platform/http.ts` chỉ cho các origin trong `AUTH_WEB_ORIGINS`, có `credentials`. App mobile không bị CORS chặn |
| Access token | Chỉ giữ trong bộ nhớ của trang, gửi `Authorization: Bearer`. Tải lại trang thì gọi `refresh` để lấy access token mới |

Web gọi bằng `fetch(url, { method: 'POST', credentials: 'include', headers: { 'X-Tripflix-Client': 'web' } })`. Ở dev, web (`localhost:3100`) và gateway (`localhost:8080`) cùng site (chỉ khác cổng), nên cookie `SameSite=Lax` vẫn được gửi. Production cần web và API cùng tên miền gốc (ví dụ `tripflix.vn` và `api.tripflix.vn`).

## Token giữa các service (TF058)

Service gọi API nội bộ của service khác bằng token riêng do `access` cấp (docs/10 §3.10), không dùng token của người dùng.

| | Cách làm |
|---|---|
| Client | Mỗi service một dòng trong `service_clients`. Secret 256 bit, database chỉ giữ bản băm argon2 |
| Token | JWT ES256 cùng khoá với access token: `{ sub: clientId, typ: "service", aud: <service nhận>, iss }`, sống **5 phút**. Không có `role`, `sid` |
| Phân tách | Token người dùng có `aud=tripflix`, token service có `aud` là tên service nhận và không được trùng `tripflix`. `AccessTokenGuard` từ chối token service; `ServiceTokenGuard` từ chối token người dùng (`401`) |
| Xin token sai | Cùng `401` cho mọi lý do (sai secret, client không có, bị vô hiệu hoá, `aud` không được phép). Lý do ghi `audit_logs`. Sai 5 lần theo client hoặc 20 lần theo IP trong 15 phút: `429` |
| Vô hiệu hoá | Không cấp token mới ngay; token đã cấp còn dùng được tới khi hết hạn (tối đa 5 phút) |
| API nội bộ của core-api | Gắn `@ServiceOnly('ai-service')` (hoặc `@ServiceOnly()` cho mọi service), nhận token có `aud=core-api`. Lấy service gọi tới bằng `@CurrentService()` |

Tạo client (in secret đúng một lần, cất vào secret của service đó, không commit):

```sh
pnpm --filter @tripflix/core-api build
pnpm --filter @tripflix/core-api auth:create-service-client ai-service core-api
pnpm --filter @tripflix/core-api auth:disable-service-client ai-service
```

Service gọi (ví dụ `ai-service` viết bằng Python): xin token, dùng lại tới gần hết 5 phút rồi xin lại.

```python
import os, time, httpx

class ServiceToken:
    def __init__(self, base_url: str, client_id: str, client_secret: str, audience: str = "core-api"):
        self.base_url, self.body = base_url, {"clientId": client_id, "clientSecret": client_secret, "audience": audience}
        self.token, self.expires_at = None, 0.0

    def get(self) -> str:
        if not self.token or time.time() > self.expires_at - 30:  # xin lại trước khi hết hạn 30 giây
            res = httpx.post(f"{self.base_url}/api/auth/service-token", json=self.body, timeout=5)
            res.raise_for_status()
            data = res.json()
            self.token, self.expires_at = data["accessToken"], time.time() + data["expiresIn"]
        return self.token

tokens = ServiceToken("http://core-api:3000", os.environ["SERVICE_CLIENT_ID"], os.environ["SERVICE_CLIENT_SECRET"])
httpx.get("http://core-api:3000/api/<api-noi-bo>", headers={"Authorization": f"Bearer {tokens.get()}"})
```

Service nhận viết bằng NestJS kiểm token như ở `libs/auth/README.md` (mục "Token service"). Service Python nhận token thì kiểm chữ ký qua `/.well-known/jwks.json`, `iss`, `aud` = tên mình, `typ == "service"`.

## Bảng

| Bảng | Ghi chú |
|---|---|
| `users` | `email` chữ thường, duy nhất. `role` thuộc `member`, `moderator`, `superadmin`. `status` thuộc `active`, `locked` |
| `sessions` | `id` là `sid`. `refresh_token_hash`, `previous_token_hash`, `rotated_at`, `expires_at`, thiết bị, IP |
| `outbox_events` | Sự kiện chờ gửi (`libs/outbox`) |
| `service_clients` | `client_id` (khoá chính), `secret_hash` (argon2), `allowed_audiences text[]`, `disabled_at` |
| `audit_logs` | Chỉ thêm: `auth.register`, `auth.login`, `auth.login_failed`, `auth.refresh`, `auth.refresh_reused`, `auth.logout`, `auth.logout_all`, `auth.session_revoked`, `auth.profile_updated`, `auth.password_changed`, `auth.password_change_failed`, `service.token_failed` (lý do trong `meta.reason`), `service.client_created`, `service.client_disabled`, cùng các hành động quản lý nhân viên ở dưới |

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate access`. Không sửa migration đã merge.

## Sự kiện phát ra

Ghi vào `access.outbox_events` trong cùng transaction, relay gửi sang `stream:core.access` khi `APP_ROLE` là `worker` hoặc `all` (`libs/outbox`).

| Sự kiện | Khi nào | Payload (`libs/contracts`) |
|---|---|---|
| `access.user.registered` v1 | Đăng ký thành công | `AccessUserRegisteredV1Schema`: `{ userId, displayName }`, không có email |
| `access.user.role_changed` v1 | Cấp hoặc thu hồi quyền | `{ userId, oldRole, newRole, changedBy }` |
| `access.user.locked` v1, `access.user.unlocked` v1 | Khoá, mở khoá | `{ userId, lockedBy }`, `{ userId, unlockedBy }` |
| `access.user.profile_updated` v1 | Đổi tên hiển thị (gửi lại cùng tên thì không phát) | `{ userId, displayName }`. Module nào lưu tên từ `access.user.registered` thì cập nhật theo |

## Job dọn dẹp

`auth/jobs/access-cleanup.job.ts`, chỉ chạy khi `APP_ROLE` là `worker` hoặc `all`: lúc khởi động rồi mỗi 24 giờ (`setInterval`).

- Xoá phiên đã quá `expires_at`.
- Xoá dòng `access.outbox_events` đã gửi (`published_at`) quá 7 ngày. Dòng chưa gửi không bao giờ bị xoá.

Chỉ có lệnh `DELETE`, nên nhiều worker cùng chạy hay chạy lại đều an toàn.

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `AUTH_JWT_PRIVATE_KEY` | trống | PEM PKCS8 ES256. Trống ở dev, test: tự sinh khoá tạm, token mất hiệu lực khi khởi động lại. Bắt buộc ở production. Sinh bằng `pnpm --filter @tripflix/core-api auth:keygen` |
| `AUTH_JWT_KID` | thumbprint của khoá | |
| `AUTH_JWT_ISSUER` | `tripflix-core` | Service kiểm token phải đặt giống |
| `AUTH_JWT_AUDIENCE` | `tripflix` | Service kiểm token phải đặt giống |
| `AUTH_WEB_ORIGINS` | `http://localhost:3100,http://localhost:3200` | Origin của web, admin: CORS và chống CSRF cho cookie. Mỗi phần tử là origin đầy đủ, không có `/` cuối |
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

Mỗi phần con (`auth/`, `account/`, `staff/`) chia:

```
<phần-con>/
├─ api/           # controller, DTO; không mở transaction
├─ application/   # use case, transaction access, ghi audit_logs
├─ domain/        # quy tắc nghiệp vụ thuần, không import @nestjs/* hay drizzle-orm
├─ infra/         # repository Drizzle, Redis, argon2, jose; infra/memory/ cho test
├─ consumers/     # nghe sự kiện (chỉ chạy khi APP_ROLE là worker hoặc all)
└─ jobs/          # job định kỳ (như trên)
```

Transaction: use case đặt `@Transactional('access')` trên hàm nhỏ chỉ gồm lệnh ghi database (người dùng, phiên, `audit_logs`, outbox). Băm argon2, Redis và ký token chạy ngoài transaction. Repository lấy executor qua `TransactionHost` (`DrizzleAccessStore(() => txHost.tx)`).

## Quản lý nhân viên (TF054)

- Quy tắc (`staff/domain/staff-policy.ts`): không tự đổi quyền hay khoá chính mình; không đổi quyền hay khoá superadmin (nên luôn còn superadmin tạo bằng seed); chỉ cấp quyền cho tài khoản đang hoạt động. Vi phạm: `409` kèm lý do.
- Đổi quyền hoặc khoá thì xoá mọi phiên của người đó trong cùng transaction rồi chặn từng `sid` trong Redis: token cũ nhận `401` ngay ở request kế tiếp, đăng nhập lại sẽ có `role` mới.
- Các lệnh này không cần `Idempotency-Key`: gửi lại cho cùng kết quả (đặt giá trị, không cộng dồn); gửi lại sau khi đã làm thì nhận `409` "đã là kiểm duyệt viên" hoặc "đã bị khoá".
- `audit_logs`: `staff.role_granted`, `staff.role_revoked`, `user.locked`, `user.unlocked` (người làm ở `actor_user_id`, người bị đổi ở `meta.targetUserId`).
