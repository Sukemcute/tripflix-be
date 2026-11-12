# TF46 — Hộp thông báo bài mới từ người đang theo dõi

- Nhánh `dung/TF46-follow-bai-moi` · Dũng (có dùng AI) · 2026-11-13

## Phần đã triển khai

- Content Social cung cấp API follow/unfollow và API nội bộ dành riêng cho service `notification-service`. Dữ liệu follower có index theo tác giả và cursor, tối đa 200 người/trang. Chỉ lấy người vẫn theo dõi và đã theo dõi trước khi đăng.
- Consumer lưu một job mỗi bài. Worker dùng advisory lock toàn cục, xử lý tối đa một lô mỗi lượt và nhường bài nhỏ sau mỗi lô. Ghi inbox và tiến cursor cùng transaction. Lỗi lô retry có giãn cách, quá 8 lần giữ trạng thái failed để tra cứu.
- Bài ẩn, gỡ, riêng tư hoặc đã xóa hủy job. Hộp thông báo loại dòng của job đã hủy qua truy vấn, không cần cập nhật hàng loạt inbox. Core kiểm trạng thái bài lại ở mỗi trang follower. Đồng bộ giữa hai service có thể trễ khi sự kiện kiểm duyệt chưa đến.
- Chưa có push Expo, nút theo dõi trên giao diện hay kết quả tải staging. Phần này không phát email.

## Cấu hình và cách kiểm lại

- Tạo service client `notification-service` với audience `core-api`, cấp secret qua cấu hình bảo mật. Đặt `FOLLOWER_CORE_URL` tới Core API nội bộ và `FOLLOWER_NOTIFICATION_SECRET` cho Notification Service. Worker mặc định chưa bật nếu thiếu secret.
- Dùng B gọi PUT follow cho A, sau đó A đăng một bài công khai. Inbox của B hiển thị thông báo bài mới. Khi bài bị ẩn, tải lại inbox để kiểm thông báo bị loại.

## Kết quả kiểm tra

- `pnpm contracts:build` thành công. Migration Content sinh bằng Drizzle.
- `pnpm --filter @tripflix/core-api test:int follow.repository` pass 1/1 trên PostgreSQL thật.
- `pnpm --filter @tripflix/notification-service test:int follower-post` pass 2/2. Test worker chạy hai replica, 1.000 follower và một bài nhỏ xen kẽ, Core API giả lập và Notification DB thật.
- Thay đổi Content Social của Thành và Notification Service của Dũng theo phạm vi đã duyệt.
