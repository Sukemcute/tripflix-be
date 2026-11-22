# TF056 — Ràng buộc refresh token với trình duyệt

- Nhánh `dung/TF056-rang-buoc-refresh` · Dũng (có dùng AI) · 2026-11-13

## Đã làm

- Login mật khẩu và Google của Web/Admin nhận bằng chứng khóa trình duyệt. Refresh token mới gắn với dấu vân tay khóa công khai. DB vẫn lưu hash của toàn bộ refresh token.
- Refresh kiểm tra chữ ký, origin, mục đích, thời hạn và mã dùng một lần. Redis lưu mã đã dùng. Server kiểm tra bằng chứng trước khi xoay hoặc thu hồi phiên.
- Web/Admin dùng cookie theo origin để hai ứng dụng cùng gọi một API mà vẫn giữ hai phiên.
- Luồng cookie cũ yêu cầu đăng nhập lại. Token cũ chưa ràng buộc vẫn cần thu hồi nếu đã bị lộ vì định dạng cũ dùng chung với mobile.

## Kết quả kiểm tra

- `pnpm contracts:build` thành công.
- `pnpm turbo run lint typecheck test --affected --output-logs=errors-only` pass 49/49.
- E2E Web Cookie ký bằng Web Crypto và kiểm thiếu chữ ký, sai khóa, dùng lại chữ ký, gửi token qua body, refresh hợp lệ, cookie Admin độc lập và tương thích mobile.
- `pnpm --filter @tripflix/core-api test:int redis-action-rate-limiter` pass 2/2 trên Redis thật.
- Chưa kiểm trình duyệt thật hoặc staging. Triển khai client Web/Admin có hỗ trợ ký trước khi triển khai backend bắt buộc chữ ký.

## Phạm vi

- Access và API client. Phần xác thực bằng mã khi đăng nhập chờ chọn kênh nhận mã.
