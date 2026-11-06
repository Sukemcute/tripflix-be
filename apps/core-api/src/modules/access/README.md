# Module `access`

- Chủ: Dũng (backup Duy)
- Database: `core`, schema `access`, user Postgres `tf_access`
- Thiết kế: docs/architecture/10 §3.10

## Phần con

| Phần | Trạng thái |
|---|---|
| `auth/`: đăng ký, đăng nhập, làm mới xoay vòng, đăng xuất, JWKS | Có (TF05); cookie refresh token cho web, admin (TF056); đăng nhập Google, gộp gu khách `X-Anon-Id` (TF059) |
| `account/`: tài khoản của tôi | Có (TF055): đổi tên, đổi mật khẩu, xem và thoát từng thiết bị, thoát mọi thiết bị. Quên và đặt lại mật khẩu (TF057) |
| `staff/`: API `/admin/*` cho nhân viên | Có (TF054): tìm người dùng, cấp và thu hồi quyền kiểm duyệt viên, khoá và mở khoá tài khoản |
| `service/`: token service-to-service | Có (TF058): bảng `service_clients`, CLI tạo và vô hiệu hoá client, `POST /auth/service-token` |

## API

| API | Ai gọi | Kết quả |
|---|---|---|
| `POST /api/auth/registration-code` `{ email, password }` | Ai cũng được | `202 { registrationId, resendAfterSeconds }`. Gửi mã khi email có thể đăng ký; email đã có tài khoản đang hoạt động thì trả y hệt nhưng gửi thư báo đã có tài khoản thay cho mã. Chưa tạo người dùng hay phiên đăng nhập. Mỗi email xin mã cách nhau 60 giây (`resendAfterSeconds`), xin sớm hơn hoặc quá giới hạn theo giờ trả `429` kèm `Retry-After` và `retryAfterSeconds` trong body |
| `POST /api/auth/register` `{ email, password, displayName, registrationId, code }` | Ai cũng được | `201` người dùng `member` có email đã xác thực. Thiếu mã, mã sai, hết hạn hoặc đã dùng trả `400`. Email được dùng bởi tài khoản khác trong lúc đăng ký trả `409` |
| `POST /api/auth/login` `{ email, password, deviceName? }` | Ai cũng được | `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }`. Sai email hay mật khẩu đều `401 "Email hoặc mật khẩu không đúng"` |
| `POST /api/auth/google` `{ idToken, deviceName? }` | Ai cũng được | Như `login`. Lần đầu tạo `member` không có mật khẩu (hoặc liên kết vào tài khoản trùng email), lần sau vào đúng tài khoản đó. Token sai: `401 "Đăng nhập bằng Google không thành công"`. Chưa đặt `GOOGLE_CLIENT_IDS`: `503`. Chế độ web (cookie) như `login` |
| `POST /api/auth/refresh` `{ refreshToken }` | Có refresh token | Cặp token mới, token cũ hết dùng được. Web, admin để body trống, token đọc từ cookie (xem "Web, admin: refresh token trong cookie") |
| `POST /api/auth/logout` | Bearer access token | `204`. Xoá phiên, access token của phiên bị từ chối ngay. Có cookie thì xoá cookie |
| `GET /api/auth/me` | Bearer access token | Hồ sơ của chính mình: thông tin người dùng + `emailVerified`, `phone`, `dateOfBirth`, `gender`, `nationality` (có thể `null`) |
| `PATCH /api/auth/me` `{ displayName?, phone?, dateOfBirth?, gender?, nationality? }` | Bearer access token | Hồ sơ sau khi sửa. Chỉ gửi trường muốn đổi, gửi `null` hoặc `""` để xoá (trừ tên). Sai định dạng: `400 { errors: [{ field, message }] }` (xem "Thông tin cá nhân" bên dưới) |
| `POST /api/auth/password/change` `{ currentPassword, newPassword }` | Bearer access token | `204`. Thiết bị khác bị đăng xuất, thiết bị đang gọi dùng tiếp. Sai mật khẩu hiện tại: `400` (không phải `401`, để client không tưởng token hết hạn) |
| `GET /api/auth/sessions` | Bearer access token | Thiết bị đang đăng nhập: `{ id, deviceName, userAgent, createdAt, lastUsedAt, isCurrent }`, dùng gần nhất trước |
| `DELETE /api/auth/sessions/{id}` | Bearer access token | `204`. Thoát thiết bị đó, token của nó nhận `401` ngay. Phiên không phải của mình: `404` |
| `POST /api/auth/logout-all` | Bearer access token | `204`. Thoát mọi thiết bị, kể cả thiết bị đang gọi. Có cookie thì xoá cookie |
| `GET /.well-known/jwks.json` | Gateway, service khác | Khoá công khai ES256. Nằm ngoài `/api` |
| `POST /api/auth/password/forgot` `{ email }` | Ai cũng được | Luôn `202 { message }` cùng một câu, kể cả email không có tài khoản. Tài khoản đang hoạt động thì nhận email có link đặt lại (sống 30 phút). Quá 3 lần mỗi giờ theo email hoặc 20 lần theo IP: `429` |
| `POST /api/auth/password/reset` `{ token, newPassword }` | Có link trong email | `204`. Đổi mật khẩu, thoát mọi thiết bị. Link sai, đã dùng, hết hạn hoặc tài khoản bị khoá: `400 "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn"` |
| `POST /api/auth/email/verify` `{ token }` | Có link trong email | `204`. Đánh dấu email đã xác thực. Link sai, đã dùng, hết hạn (24 giờ) hoặc tài khoản bị khoá: `400 "Liên kết xác thực email không hợp lệ hoặc đã hết hạn"`. Client đang đăng nhập gọi `refresh` để có access token mới `ev: true` |
| `POST /api/auth/email/verification` | Bearer access token | `200 { status, message }`: `sent` (link mới, link cũ hết dùng được) hoặc `already_verified` (không gửi). Quá 3 lần mỗi giờ theo tài khoản hoặc 20 lần theo IP: `429` |
| `POST /api/auth/service-token` `{ clientId, clientSecret, audience }` | Service khác (không phải người dùng) | `{ accessToken, tokenType: "Bearer", expiresIn: 300 }`. Sai bất kỳ thông tin nào: `401 "Thông tin service không đúng"`. Xem "Token giữa các service" |
| `GET /api/admin/me` | `moderator`, `superadmin` | Nhân viên đang đăng nhập |
| `GET /api/admin/staff` | `superadmin` | Danh sách tài khoản nhân viên |
| `GET /api/admin/users?query=&page=` | `moderator`, `superadmin` | Tìm theo email, tên; 20 người mỗi trang. Moderator thấy email đã che (`kh***@example.com`) |
| `POST /api/admin/staff` `{ userId }` | `superadmin` | Cấp `moderator` |
| `DELETE /api/admin/staff/{userId}` | `superadmin` | Thu hồi về `member` |
| `POST /api/admin/users/{userId}/lock`, `/unlock` | `superadmin` | Khoá: không đăng nhập được. Mở khoá: đăng nhập lại được |

Chưa đăng nhập: `401`. Sai vai trò: `403`. Module khác chặn quyền bằng `@Roles(...)` của `@tripflix/auth` (xem `libs/auth/README.md`). Chưa xác thực email ở API có `@RequireVerifiedEmail()`: `403 { code: "email_unverified" }`.

## Token

| | Cách làm |
|---|---|
| Access token | JWT ES256 ký bằng `jose`, sống 15 phút. Claim `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud`; header có `kid` |
| Refresh token | Chuỗi ngẫu nhiên 256 bit. Database chỉ lưu SHA-256 của nó trong `sessions`. Sống 30 ngày, tính lại mỗi lần làm mới |
| Xoay vòng | Mỗi lần `/auth/refresh` cấp refresh token mới; token vừa dùng thành `previous_token_hash` |
| Dùng lại token cũ | Trong 10 giây sau lần xoay: vẫn cấp cặp mới (phòng mạng làm mất phản hồi). Quá 10 giây: xoá phiên, chặn `sid`, ghi `auth.refresh_reused`, trả `401` |
| Thu hồi ngay | Đăng xuất, thoát thiết bị, đổi mật khẩu hoặc dùng lại token cũ: ghi `auth:revoked-sid:<sid>` vào Redis tới khi access token hết hạn. Mọi service dùng `@tripflix/auth` đều kiểm khoá này |
| Đăng nhập sai | Sai 5 lần theo email hoặc 20 lần theo IP trong 15 phút: `429` kèm `Retry-After`. Email không tồn tại vẫn chạy argon2 để không lộ email nào có tài khoản. Nhập sai mật khẩu hiện tại khi đổi mật khẩu cũng tính vào giới hạn này |
| Mật khẩu | argon2id. Mật khẩu mới 8–64 ký tự (đăng ký 12–64), mật khẩu đang dùng nhận tới 128 ký tự |

## Đăng nhập Google và khách vãng lai (TF059)

- App, web dùng Google Sign-In lấy **ID token** rồi gửi `POST /api/auth/google`. core-api tự kiểm chữ ký RS256 qua JWKS của Google, `iss` (`accounts.google.com`), `aud` thuộc `GOOGLE_CLIENT_IDS`, `exp`, `email_verified = true`. Không gọi API Google nào khác.
- Thứ tự tìm tài khoản: đã liên kết `(google, sub)` → vào tài khoản đó; trùng email (Google đã xác minh) → liên kết; chưa có → tạo `member` không có mật khẩu, tên lấy từ `name` của Google. Tài khoản bị khoá: `401`, không liên kết thêm.
- Đăng nhập Google đánh dấu email đã xác thực (TF05D). Liên kết vào tài khoản mật khẩu **chưa** xác thực thì xoá mật khẩu và mọi phiên cũ: mật khẩu đó có thể do người khác đặt trước bằng email của chủ thật (chiếm tài khoản trước). Audit `auth.google_linked` ghi `clearedUnverifiedPassword`.
- Tài khoản chỉ có Google: đăng nhập bằng mật khẩu nhận lỗi chung; muốn có mật khẩu thì dùng "quên mật khẩu".
- `X-Anon-Id`: app sinh một UUID cho khách chưa đăng nhập và gửi kèm mọi request. Đăng ký, đăng nhập (cả Google) thành công thì ghi `access.user.guest_merged` trong cùng transaction. Header sai dạng thì bỏ qua.

## Quên mật khẩu (TF057)

1. Web gọi `POST /api/auth/password/forgot { email }`, luôn hiện câu trong `message`.
2. Có tài khoản đang hoạt động: trong một transaction, xoá link cũ chưa dùng, lưu SHA-256 của token mới, ghi `audit_logs`, ghi outbox `access.password_reset_requested`.
3. Relay gửi sang `stream:core.access`; `notification-service` (consumer group `notification`) gửi email tiếng Việt qua SMTP. Dev: xem ở Mailpit `http://localhost:8025`.
4. Người dùng mở link `AUTH_PASSWORD_RESET_URL?token=...`, trang web gọi `POST /api/auth/password/reset { token, newPassword }`.
5. Đúng: đổi mật khẩu, đánh dấu token đã dùng (một lệnh `UPDATE`, hai request cùng lúc chỉ một cái thắng), xoá mọi phiên, chặn `sid` trong Redis.

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
| `users` | `email` chữ thường, duy nhất. `role` thuộc `member`, `moderator`, `superadmin`. `status` thuộc `active`, `locked`. `password_hash` trống với tài khoản chỉ có Google. Thông tin cá nhân (TF06M, đều có thể trống): `phone` (`^[+]?[0-9]{8,15}$`), `date_of_birth` (`date`), `gender` (`male`, `female`, `other`), `nationality` (ISO 3166-1 alpha-2 chữ hoa), có check ở DB |
| `user_identities` | Liên kết đăng nhập ngoài: khoá chính `(provider, subject)` (`subject` là `sub` của Google), `user_id`, `email` lúc liên kết |
| `sessions` | `id` là `sid`. `refresh_token_hash`, `previous_token_hash`, `rotated_at`, `expires_at`, thiết bị, IP |
| `outbox_events` | Sự kiện chờ gửi (`libs/outbox`) |
| `password_resets` | `token_hash` (SHA-256 của token trên link, duy nhất), `expires_at` (30 phút), `used_at`. Yêu cầu mới xoá token chưa dùng của người đó |
| `service_clients` | `client_id` (khoá chính), `secret_hash` (argon2), `allowed_audiences text[]`, `disabled_at` |
| `audit_logs` | Chỉ thêm: `auth.register`, `auth.login`, `auth.login_failed`, `auth.refresh`, `auth.refresh_reused`, `auth.logout`, `auth.logout_all`, `auth.session_revoked`, `auth.profile_updated`, `auth.password_changed`, `auth.password_change_failed`, `auth.password_reset_requested`, `auth.password_reset`, `auth.google_linked` (`auth.register`, `auth.login` có `meta.provider`), `service.token_failed` (lý do trong `meta.reason`), `service.client_created`, `service.client_disabled`, cùng các hành động quản lý nhân viên ở dưới |

Bảng khai báo trong `db/schema/`. Sinh migration: `pnpm db:generate access`. Không sửa migration đã merge.

## Sự kiện phát ra

Ghi vào `access.outbox_events` trong cùng transaction, relay gửi sang `stream:core.access` khi `APP_ROLE` là `worker` hoặc `all` (`libs/outbox`).

| Sự kiện | Khi nào | Payload (`libs/contracts`) |
|---|---|---|
| `access.user.registered` v1 | Đăng ký thành công | `AccessUserRegisteredV1Schema`: `{ userId, displayName }`, không có email |
| `access.user.role_changed` v1 | Cấp hoặc thu hồi quyền | `{ userId, oldRole, newRole, changedBy }` |
| `access.user.locked` v1, `access.user.unlocked` v1 | Khoá, mở khoá | `{ userId, lockedBy }`, `{ userId, unlockedBy }` |
| `access.user.profile_updated` v1 | Đổi tên hiển thị (gửi lại cùng tên, hoặc chỉ đổi thông tin cá nhân thì không phát) | `{ userId, displayName }`. Module nào lưu tên từ `access.user.registered` thì cập nhật theo |
| `access.user.guest_merged` v1 | Đăng ký, đăng nhập hoặc đăng nhập Google thành công có header `X-Anon-Id` (UUID) | `{ anonId, userId }`, đúng một sự kiện mỗi lần. `discovery`, `feed` gộp gu đã ghi theo `anonId` vào `userId` |
| `access.user.welcome_email_requested` v1 | Đã tạo tài khoản bằng mã đăng ký hoặc lần đầu qua Google | `{ userId, email, displayName, provider }`. Chỉ `notification-service` dùng |
| `access.registration_code_requested` v1 | Người dùng yêu cầu mã đăng ký | `{ email, code, expiresAt }`. Chỉ `notification-service` dùng |
| `access.registration_attempted_existing` v1 | Xin mã đăng ký bằng email đã có tài khoản đang hoạt động. API vẫn trả 202 như email mới, không tạo mã | `{ userId, email, displayName, hasPassword }`. Chỉ `notification-service` dùng: gửi thư báo đã có tài khoản kèm link đăng nhập, quên mật khẩu |
| `access.email_verification_requested` v1 (TF05D) | Tài khoản cũ chưa xác thực yêu cầu gửi link | `{ userId, email, displayName, verifyUrl, expiresAt, reason }`. Chỉ `notification-service` dùng |
| `access.password_reset_requested` v1 | Quên mật khẩu, tài khoản đang hoạt động | `{ userId, email, displayName, resetUrl, expiresAt }`. Có email vì `notification-service` cần người nhận (docs/10 §3.5). `resetUrl` chứa token dùng một lần: chỉ `notification-service` được dùng sự kiện này |

## Job dọn dẹp

`auth/jobs/access-cleanup.job.ts`, chỉ chạy khi `APP_ROLE` là `worker` hoặc `all`: lúc khởi động rồi mỗi 24 giờ (`setInterval`).

- Xoá phiên đã quá `expires_at`.
- Xoá token đặt lại mật khẩu và link xác thực email đã quá `expires_at` (đã dùng hay chưa).
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
| `AUTH_PASSWORD_RESET_URL` | `http://localhost:3100/dat-lai-mat-khau` | Trang đặt lại mật khẩu của web. Link trong email là địa chỉ này kèm `?token=...` |
| `AUTH_EMAIL_VERIFY_URL` | `http://localhost:3100/xac-thuc-email` | Trang xác thực email của web. Link trong email là địa chỉ này kèm `?token=...` |
| `AUTH_REGISTER_MAX_PER_IP_HOUR` | `5` | Số yêu cầu gửi mã đăng ký mỗi IP mỗi giờ. Máy dev, CI chạy e2e có thể đặt cao hơn |
| `GOOGLE_CLIENT_IDS` | trống | OAuth Client ID (Web, Android, iOS) trên Google Cloud Console, cách nhau bởi dấu phẩy. Trống: tắt đăng nhập Google (`503`) |
| `GOOGLE_JWKS_URL` | `https://www.googleapis.com/oauth2/v3/certs` | Khoá công khai của Google. Test đổi sang server JWKS giả |
| `SEED_PASSWORD` | | Chỉ cho `pnpm db:seed` |

## Chạy trên máy

```sh
pnpm stack:infra
pnpm db:migrate
pnpm db:seed      # superadmin@, moderator@, member@tripflix.local, mật khẩu SEED_PASSWORD
```

Máy đã chạy `pnpm stack:infra` **trước** commit `fix(deploy): cấp quyền CREATE...` thì chạy một lần, không mất dữ liệu:

```sh
docker exec tripflix-postgres-1 psql -U postgres -c "GRANT CREATE ON DATABASE core TO tf_access, tf_content, tf_discovery, tf_analytics, tf_commerce" -c "GRANT CREATE ON DATABASE notification TO tf_notification"
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

## Thông tin cá nhân (TF06M)

- Số điện thoại, ngày sinh, giới tính, quốc tịch chỉ chủ tài khoản xem và sửa qua `GET/PATCH /auth/me`. Không có trong danh sách nhân viên, tìm người dùng của admin, phản hồi đăng ký/đăng nhập, và không lên event bus.
- Audit `auth.profile_updated` chỉ ghi `meta.changedFields` (tên trường), không ghi giá trị; tên hiển thị vẫn ghi `oldDisplayName`, `newDisplayName`.
- Kiểm tra (`account/domain/personal-info.ts`, `account/api/dto.ts`): số điện thoại bỏ dấu cách, chấm, gạch, ngoặc rồi phải có 8–15 chữ số (có thể `+` ở đầu); ngày sinh `YYYY-MM-DD`, tuổi 13–120 tại ngày gọi API; giới tính trong danh sách; quốc tịch là mã ISO 3166-1 alpha-2 có thật (`account/domain/countries.ts`, 249 mã), tự viết hoa.

## Kiểm dữ liệu đầu vào (TF05C)

- Mọi body, query đi qua `ZodBody` (`auth/api/http.ts`). Sai thì `400 { message: "Dữ liệu gửi lên không hợp lệ", errors: [{ field, message }] }`, mỗi trường sai báo một lỗi, câu tiếng Việt. Câu mặc định tiếng Anh của zod được thay bằng `accessErrorMap` (`auth/api/validation.ts`), chỉ trong module này.
- Không có body, body là mảng, chuỗi: một lỗi ở gốc (`field: ""`). JSON hỏng: 400 từ Express.
- Trường lạ bị bỏ (ví dụ gửi `role`, `status` khi đăng ký hay `email` khi sửa hồ sơ thì không có tác dụng).
- Các trường dùng chung (`auth/api/validation.ts`, quy tắc chữ ở `auth/domain/text-rules.ts`):

| Trường | Quy tắc |
| --- | --- |
| Email đăng ký | Cắt khoảng trắng hai đầu rồi kiểm định dạng, tối đa 254 ký tự; lưu chữ thường |
| Email đăng nhập, quên mật khẩu | Chỉ cần có (cắt khoảng trắng), không kiểm định dạng: sai thì nhận câu trả lời chung, không lộ email nào đã đăng ký |
| Mật khẩu mới khi đăng ký | 12–64 ký tự, chặn một số mật khẩu phổ biến, chuỗi số dễ đoán và mẫu lặp đơn giản |
| Mật khẩu khi đổi hoặc đặt lại | 8–64 ký tự và có ít nhất một ký tự nhìn thấy |
| Mật khẩu hiện tại (đăng nhập, đổi mật khẩu) | 1–128 ký tự, để tài khoản tạo trước TF05C hoặc đặt mật khẩu dài hơn 64 trước khi giảm giới hạn vẫn đăng nhập được |
| Tên hiển thị | Chuẩn hoá Unicode NFC, cắt khoảng trắng, 1–30 ký tự, một dòng (không có xuống dòng, tab, ký tự điều khiển), có ít nhất một ký tự nhìn thấy. Không lọc HTML: web, app tự escape khi hiển thị. Tên lấy từ Google được làm sạch theo cùng quy tắc và cắt còn 30 ký tự (`buildDisplayName`). Tên đã lưu dài hơn 30 trước khi giảm giới hạn vẫn giữ, lần sửa sau phải rút gọn |
| Tên thiết bị | Ký tự điều khiển đổi thành dấu cách, tối đa 100 ký tự; trống thì lưu `null` |

- Độ dài đếm theo ký tự Unicode: một emoji tính 1 ký tự.
- DB vẫn có check riêng cho `users` (role, status, email chữ thường, phone, gender, nationality dạng `^[A-Z]{2}$`); test: `drizzle-access.store.int.spec.ts` (TF05C). Danh sách mã quốc gia chỉ kiểm ở API.
- Test: `auth/api/validation.spec.ts` (từng schema, từng trường, các trường hợp biên), `auth/domain/text-rules.spec.ts`, `account/domain/countries.spec.ts`, `account/domain/personal-info.spec.ts`, `validation.e2e.spec.ts` (qua HTTP).

## Xác thực email (TF05D)

- Đăng ký bằng mật khẩu yêu cầu mã 8 chữ số, hiệu lực 10 phút. Gửi lại thay mã cũ. Backend tạo người dùng và tiêu mã trong cùng transaction. Tài khoản mới có `email_verified_at` ngay khi được tạo.
- Tài khoản cũ chưa xác thực vẫn dùng link, đặt lại mật khẩu qua email hoặc đăng nhập Google để xác thực. Ba tài khoản mẫu `@tripflix.local` được seed với email đã xác thực.
- Link dùng một lần và có hiệu lực 24 giờ. Bảng `email_verifications` lưu bản băm SHA-256 của token 256 bit. Khi gửi lại, link cũ hết hiệu lực. Các thao tác gửi lại và xác thực cùng khóa theo người dùng để xử lý tuần tự.
- Access token có claim `ev` (true/false), đọc lại từ database mỗi lần cấp (đăng nhập, refresh). Tạo bản nháp, đăng bài và tạo bình luận yêu cầu `@RequireVerifiedEmail()` của `@tripflix/auth`. Nếu email chưa xác thực, API trả `403` với mã `email_unverified`. Phiên đã đăng nhập cần làm mới access token sau khi xác thực.
- Redis giới hạn yêu cầu gửi mã theo IP và địa chỉ email, đồng thời giới hạn thử mã theo IP và mã yêu cầu. Dịch vụ từ chối xử lý khi không đọc được bộ giới hạn.
- Audit: `auth.email_verification_requested` (`meta.reason`), `auth.email_verified` (`meta.via`: `link`, `google`).
- Gửi email thật trên server: `deploy/SERVER.md`, Giai đoạn 4 (Amazon SES).
