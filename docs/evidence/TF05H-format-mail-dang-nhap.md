# TF05H — Thiết kế lại giao diện email thông báo đăng nhập và tài khoản

- Notion: chưa có · Nhánh: `dung/TF05H-format-mail-dang-nhap` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-12

## Đã làm
- **Khung email HTML chuẩn thương hiệu (`renderEmailShell` trong `html.ts`)**:
  - Dùng layout dạng bảng (table-based) tương thích 100% với mọi email client (Gmail, Outlook, iOS Mail, Apple Mail, Webmail).
  - Tông màu thương hiệu Tripflix: nền màu be ấm `#FFF7F2`, thẻ card màu trắng bo góc 16px viền `#E2E8F0`.
  - Header nổi bật với logo Tripflix đỏ cam (`#FF5A3C`), slogan `Chạm cảm hứng, trọn hành trình.`.
  - Nút bấm CTA màu đỏ cam `#BC331E` bo góc 12px chuẩn bảng email.
  - Footer thông báo hệ thống tự động và thương hiệu Tripflix.
- **Email thông báo đăng nhập mới (`login-notification.email.ts`)**:
  - Badge trạng thái `✓ ĐĂNG NHẬP THÀNH CÔNG`.
  - Bảng chi tiết phiên: thời gian, thiết bị, địa chỉ IP, vị trí ước tính.
  - Hộp cảnh báo bảo mật và nút chuyển tới trang quản lý phiên đăng nhập `/account`, kèm link đặt lại mật khẩu.
  - Unit test trong `login-notification.email.spec.ts` kiểm tra thoát ký tự HTML và cấu trúc nội dung.
- **Email cảnh báo phiên đăng nhập bị đăng xuất (`session-reuse.email.ts`)**:
  - Chuyển sang khung chuẩn Tripflix với badge cảnh báo `🔒 CẢNH BÁO BẢO MẬT`.
  - Bảng chi tiết phiên bị thu hồi, hộp cảnh báo và nút CTA "Đăng nhập lại".
- **Đồng bộ nâng cấp các email tài khoản khác**:
  - `registration-code.email.ts`: Hộp mã xác thực 8 số monospace nổi bật với viền dashed cam `#FF5A3C` và nền `#FFF0EB`.
  - `welcome.email.ts`: Danh sách tính năng dạng icon check xanh ngọc, hộp thông tin đăng nhập theo provider.
  - `password-reset.email.ts`: Nút CTA đặt mật khẩu mới, hộp lưu ý thời hạn 30 phút.
  - `existing-account.email.ts`: Hướng dẫn đăng nhập / đặt lại mật khẩu khi đăng ký trùng email.
  - `email-verification.email.ts`: Nút CTA xác nhận email và khung link dự phòng.

## Kết quả kiểm tra
- `notification-service`:
  - `pnpm lint`: 0 warnings, 0 errors.
  - `pnpm typecheck`: Pass không có lỗi nào.
  - Unit tests: 14 test files pass 100% (bao gồm `login-notification.email.spec.ts`, `session-reuse.email.spec.ts`, `existing-account.email.spec.ts`, `email-verification.email.spec.ts`, `order-confirmation.email.spec.ts`, `event-router.spec.ts`).
  - Build: Nest build thành công.

## Cách kiểm lại
1. Mở file `email-preview-login.html` trên trình duyệt để kiểm tra giao diện 3 mẫu email.
2. `pnpm --filter @tripflix/notification-service exec vitest run src/outapp`
3. `pnpm --filter @tripflix/notification-service exec vitest run src/consumers/event-router.spec.ts`

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa đổi nội bộ trong `notification-service` (`src/outapp`), không sửa schema database, không đổi API contracts.
