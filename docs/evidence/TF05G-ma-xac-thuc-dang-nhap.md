# TF05G — Mã xác thực 8 số qua email khi đăng nhập bằng mật khẩu

- Nhánh: `dung/TF05G-ma-xac-thuc-dang-nhap` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-13

## Đã làm
- Thêm endpoint `POST /api/auth/login-code` nhận `email` và `password` (hỗ trợ cả `encPassword` mã hoá X25519):
  - Kiểm tra giới hạn số lần đăng nhập sai (`LoginRateLimiter`) và xác thực mật khẩu của tài khoản bằng Argon2 với thời gian phản hồi hằng số.
  - Nếu đúng mật khẩu và tài khoản đang hoạt động (`active`), áp dụng giới hạn gửi lại mã 60 giây, sinh mã xác thực 8 chữ số có hiệu lực 10 phút, lưu bản băm vào `registration_challenges` theo khoá `login:<email>` và phát sự kiện `access.registration_code_requested` (`purpose: 'login'`).
- Mở rộng `POST /api/auth/login` nhận thêm hai trường tuỳ chọn `loginChallengeId` và `code`:
  - Khi gửi kèm `loginChallengeId` và `code`, kiểm tra giới hạn thử mã, đối chiếu bản băm của mã xác thực và tiêu mã nguyên tử trong cùng transaction mở phiên đăng nhập.
  - Vẫn tương thích ngược với các luồng gọi `POST /api/auth/login` không truyền mã (tự động đăng nhập ngay sau khi đăng ký, ứng dụng mobile/admin và bộ test E2E hiện có).
- Cập nhật `buildRegistrationCodeEmail` trong `notification-service` hiển thị đúng tiêu đề và nội dung cho email mã xác thực đăng nhập khi `purpose === 'login'`.
- Cập nhật hợp đồng OpenAPI (`contracts/openapi/core-api.json`) và JSON Schema sự kiện (`contracts/events/access.registration_code_requested.v1.schema.json`).

## Kết quả kiểm tra
- `@tripflix/contracts`: `lint`, `typecheck`, `test` (8 tests) pass 100%.
- `@tripflix/core-api`: `lint`, `typecheck`, `test` (bao gồm unit test `AuthUseCases.login` và E2E test `POST /api/auth/login-code` → `POST /api/auth/login`) pass 100%.
- `@tripflix/notification-service`: `lint`, `typecheck`, `event-router.spec.ts` (15 tests) pass 100%.

## Ảnh hưởng tới phần của người khác
- Không. Chỉ bổ sung endpoint mới và trường tuỳ chọn tương thích ngược trong module `access`, `contracts` và `notification-service` (đều do Dũng phụ trách).
