# Cấu hình từ khóa kiểm duyệt

- Superadmin quản lý quy tắc từ khóa toàn hệ thống. Quy tắc được lưu trong PostgreSQL sau khi migration tạo bảng.
- Bộ quét đọc các quy tắc đang bật. Cụm từ khớp đưa nội dung vào hàng chờ để nhân viên quyết định.
- Build, sinh OpenAPI, lint và typecheck đã chạy. 13 test API và logic khớp từ khóa pass. Kiểm tra với PostgreSQL thật được đưa vào CI vì Docker local không phản hồi.
- Kiểm tra staging sau khi deploy cả API và Portal. Thử thêm, sửa, tắt, bật rồi gửi bình luận có cụm từ riêng.
