# TF46B — Handler và directory của Notification

- Task SCRUM-79 · Nhánh `dung/TF46B-handler-va-directory` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- `EventRouter` chọn handler theo loại và phiên bản sự kiện. Handler email tài khoản và handler đặt chỗ giữ quy tắc gửi hiện tại. Đơn đã thanh toán luôn tạo thông báo inbox khi chạy qua consumer, email xác nhận chỉ gửi tới email liên hệ của đơn.
- Consumer và công việc đọc lại dead-letter cùng dùng handler directory. Sự kiện đăng ký, đổi tên, đăng bài và xóa bài cập nhật hai bảng trong database Notification. Sự kiện cũ đến trễ không ghi đè tên mới hoặc làm mất dấu xóa bài.
- Directory lưu tên hiển thị và thông tin bài từ sự kiện hiện có. Không cần đọc DB Core API hay sao chép email tài khoản.

## Kiểm tra

- Build, lint, typecheck và test Notification Service cùng các dependency qua 32/32 tác vụ.
- Test tích hợp Notification qua 14/14, gồm cập nhật directory trên PostgreSQL, sự kiện trùng và sự kiện đến sai thứ tự.

## Phạm vi

- Directory bắt đầu cập nhật từ sự kiện được xử lý sau khi triển khai. Chưa có backfill dữ liệu lịch sử.
- Cơ chế đánh dấu sự kiện đã xử lý và thời hạn gửi email giữ theo code hiện tại.
- Phần đặt chỗ do Thắng triển khai ban đầu. Giữ hành vi gửi email, inbox và realtime khi tách handler.
