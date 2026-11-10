# TF056 — Mã hoá mật khẩu trước khi gửi, bỏ mật khẩu mặc định của nhân sự

- Jira: chưa có task TF056 riêng (thuộc TF05, SCRUM-9); phần làm tiếp: [SCRUM-106 TF056C](https://tripflix.atlassian.net/browse/SCRUM-106) · Nhánh: `dung/TF056-ma-hoa-mat-khau` (BE và FE) · Người làm: Hoàng Đức Dũng (dùng AI: có) · Ngày: 2026-11-10

## Vấn đề
- Mở DevTools → tab Payload khi đăng nhập, đăng ký, đổi hay đặt lại mật khẩu thì thấy mật khẩu gốc. HTTPS che được trên đường truyền, nhưng mật khẩu vẫn lộ ở DevTools, extension, proxy công ty, log của gateway và log request.
- Admin tạo nhân sự với mật khẩu mặc định `Tripflix@2025` khi bỏ trống ô mật khẩu. Ô mật khẩu có khoảng trắng bị cắt rồi cũng rơi về mật khẩu mặc định, và superadmin tạo được cả tài khoản superadmin khác.
- Cách làm trước (OPAQUE) khoá các tài khoản cũ chỉ có hash Argon2: 67 tài khoản local không đăng nhập được. Bản này thay OPAQUE và giữ nguyên Argon2 ở server.

## Cách làm (giống "#PWD_BROWSER" của Facebook)
- Server có cặp khoá X25519. `GET /api/auth/password-key` trả khoá công khai (`keyId`, `publicKey`, `serverTime`), `Cache-Control: no-store`.
- Client mã hoá từng mật khẩu thành `#TFPWD:1:<keyId>:<ts>:<base64url(khoá tạm ‖ iv ‖ bản mã ‖ tag)>`:
  - X25519 với khoá tạm mới cho mỗi lần gửi.
  - HKDF-SHA256, salt = khoá tạm ‖ khoá server, info `tripflix-pwd-v1`.
  - AES-256-GCM.
- AAD = `tripflix-pwd|1|<mục đích>|<keyId>|<ts>|<email>`. Mục đích là `login`, `register`, `change_current`, `change_new` hoặc `reset`. Email (trim, chữ thường) chỉ gắn cho `login` và `register`. Nhờ AAD, chuỗi mã hoá cho đăng nhập không dùng lại được cho đổi mật khẩu hay cho email khác.
- Trong bản mã là `{p, n, t}`. `t` phải nằm trong 300 giây gần nhất và không vượt quá hiện tại 60 giây. Nonce `n` chỉ dùng được 1 lần, ghi vào Redis 600 giây, nên chuỗi chụp lại không gửi lại được.
- `PasswordDecryptionInterceptor` giải mã các trường `enc*` trước `ZodBody`. Vì vậy luật mật khẩu, Argon2 và use case không đổi gì.
- Lỗi trả 400 với `code`:
  - `password_envelope_invalid`: hết hạn, sai khoá, dùng lại hoặc sửa bản mã.
  - `password_encryption_required`: gửi mật khẩu thường khi server đã bật chế độ bắt buộc mã hoá.
  - Log chỉ ghi lý do lỗi, không ghi chuỗi mã hoá.
- Chuyển đổi dần:
  - `AUTH_PASSWORD_ENCRYPTION_REQUIRED=false` (mặc định): vẫn nhận mật khẩu thường từ app cũ.
  - Khi mọi client đã cập nhật thì bật `true`.
  - `AUTH_PASSWORD_KEYS="k1:<khoá>,k0:<khoá cũ>"`: khoá đầu tiên đang dùng, các khoá sau chỉ để giải mã trong lúc xoay khoá.
  - Production thiếu khoá thì tắt mã hoá (`/password-key` trả 503) thay vì làm hỏng lúc khởi động. Dev tự sinh khoá tạm.
- Sinh khoá: `pnpm --filter core-api auth:password-keygen`. `deploy/init-server-env.sh` tự sinh khoá cho server mới.

## Tạo nhân sự (superadmin)
- `POST /api/admin/users` chỉ nhận `{ email, displayName, role? }`, trong đó `role` chỉ nhận `moderator`, giá trị khác trả 400.
- `password` và `encPassword` gửi kèm bị bỏ qua. Tài khoản tạo ra chưa có mật khẩu, và nhân sự nhận email đặt mật khẩu theo luồng quên mật khẩu (link 30 phút).
- Bỏ `Tripflix@2025` khỏi server và admin.
- Xin mã đăng ký (`/auth/registration-code`) không nhận mật khẩu nữa. Mật khẩu chỉ gửi ở bước `register`, đã mã hoá.
- Để sang TF056C (SCRUM-106):
  - Thư mời riêng 24 giờ.
  - Chỉ đánh dấu email đã xác thực khi nhân sự mở link. Hiện `createStaff` vẫn đặt `emailVerifiedAt` lúc tạo.
  - Màn xác nhận trước khi tạo.
  - Nút "Cấp quyền kiểm duyệt" khi email đã có tài khoản.

## Client (tripflix-fe, cùng tên nhánh)
- `@tripflix/api-client` mã hoá bằng `@noble/curves`, `@noble/ciphers`, `@noble/hashes` 2.4.0. Khoá được giữ 10 phút và chỉnh theo lệch giờ với server. Nếu bị từ chối vì `password_envelope_invalid` thì client lấy khoá mới và gửi lại đúng 1 lần.
- Web: đăng nhập, đăng ký, đổi và đặt lại mật khẩu. Admin: đăng nhập, form tạo nhân sự không còn ô mật khẩu. Mobile: đăng nhập, đăng ký, đổi mật khẩu; `crypto.getRandomValues` cho Hermes lấy từ `expo-crypto`.

## Kết quả kiểm tra
Chạy ngày 2026-11-10, Node 24.22.1, pnpm 10.32.1, Docker 28.3.2:

```
tripflix-be / core-api
  tsc --noEmit   → pass
  pnpm lint      → 0 lỗi (cảnh báo còn lại ở social-use-cases.spec.ts, không thuộc TF056)
  vitest run     → 76 file, 2087 test pass, 1 skip
    trong đó password-envelope, x25519-password-keyring, password-encryption (unit)
    và password-encryption.e2e.spec.ts (các mục đích, dùng lại, hết hạn, sửa bản mã, sai mục đích, sai email,
    gửi cả hai trường, chế độ bắt buộc, tạo nhân sự không mật khẩu, role khác moderator → 400)

tripflix-fe
  turbo typecheck lint test (api-client, web, admin, mobile) → 10/10 task pass, lint 0 lỗi
  api-client 143 test pass (có bộ giải mã độc lập bằng node:crypto để đối chiếu từng byte)
  mobile: giả lập Hermes không có crypto → không polyfill thì báo lỗi, có polyfill thì mã hoá được;
          expo export --platform android đóng gói được (5,5 MB Hermes bytecode)
```

Đối chiếu FE ↔ BE: chuỗi do `@noble` mã hoá được `PasswordEncryption.open` thật của core-api giải mã cho cả 5 mục đích. Gửi lại, sai mục đích và hết hạn đều bị từ chối.

Kiểm thật trong Chrome (headless, đọc body request như tab Payload). Web :3100 và admin :3200 gọi core-api :3000 qua gateway :8080. Token đặt lại mật khẩu được tạo thẳng trong DB local để không gửi thư thật:

```
web, member@tripflix.local                                         5/5 PASS
  POST /api/auth/login            → 200  email, deviceName, encPassword
  POST /api/auth/password/change  → 204  encCurrentPassword, encNewPassword   (đổi sang mật khẩu tạm)
  POST /api/auth/password/change  → 204  encCurrentPassword, encNewPassword   (đổi lại)
  POST /api/auth/password/reset   → 204  token, encNewPassword
  POST /api/auth/login            → 200  email, deviceName, encPassword       (đăng nhập lại)
admin, superadmin@tripflix.local
  POST /api/auth/login            → 200  email, encPassword
  form tạo nhân sự: không ô mật khẩu, không chữ Tripflix@2025, không lựa chọn superadmin
  POST /api/admin/users (email đã có) → 400, form hiện "Email đã tồn tại trong hệ thống"
  POST /api/admin/users (email mới)   → 201  displayName, email, role
       tài khoản moderator chưa có mật khẩu, notification-service gửi thư đặt mật khẩu,
       nhân sự mở link trong thư và đặt mật khẩu được (link đã dùng 1 lần)
```

Không body nào chứa mật khẩu gốc. Log core-api không có mật khẩu gốc, cũng không có chuỗi `#TFPWD`.

## Việc còn lại
- Thứ tự merge: nhánh BE trước, FE sau. FE mới xin mã đăng ký chỉ bằng email, mà core-api cũ vẫn bắt buộc có `password`.
- Bật `AUTH_PASSWORD_ENCRYPTION_REQUIRED=true` khi app mobile bản mới đã tới tay người dùng. App cũ vẫn gửi mật khẩu thường.
- Server staging và production cần có `AUTH_PASSWORD_KEYS` trước khi deploy. Thiếu thì server vẫn chạy nhưng mã hoá tắt.
- Mobile thêm module native `expo-crypto`: cần build lại APK hoặc dev client. Expo Go có sẵn module này.
- Tài khoản local nào có `password_hash = NULL` (đăng ký bằng Google, hoặc bị OPAQUE làm mất hash) thì đặt mật khẩu qua "Quên mật khẩu".
- TF056C (SCRUM-106).
