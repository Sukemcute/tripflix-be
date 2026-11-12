# TF46D — Thông báo bình luận và trả lời

- SCRUM-81 · Nhánh `dung/TF46D-thong-bao-binh-luan` · Dũng (có dùng AI) · 2026-11-12
- Phụ thuộc backend TF46C (#154). Frontend TF46C (#131) nghe tín hiệu cập nhật để làm mới chuông khi bình luận bị xóa.

## Đã làm

- Content Social của Thành tái sử dụng bình luận cha đã đọc để đưa `parentCommentAuthorId` vào sự kiện outbox cùng transaction. Hợp đồng v1 tiếp tục nhận payload cũ thiếu trường này.
- Handler gộp tác giả bài và tác giả bình luận cha, loại người vừa bình luận và ưu tiên nội dung trả lời khi hai vai trò trùng nhau. Tên hiển thị lấy từ directory. Khi chưa có tên, thông báo dùng “Một người dùng”. Link mở bài viết trên Web.
- Ghi tối đa hai dòng inbox bằng một câu lệnh và chỉ phát realtime sau commit. Retry dựa trên khóa chống trùng TF46A.
- Migration v3 thêm dấu xóa và chỉ mục theo comment ID. Handler tạo và xóa cùng bình luận dùng khóa transaction để xóa đến trước hoặc đồng thời không làm thông báo hiện lại. Các truy vấn inbox, đếm và đánh dấu đọc bỏ qua hàng đã xóa.

## Kiểm tra

- Lint, typecheck và test backend qua 49/49 tác vụ. Build và kiểm tra package Notification qua 32/32 tác vụ.
- Core API qua 41 test Social, gồm phát sự kiện bình luận gốc và trả lời có tác giả bình luận cha.
- 19/19 test tích hợp Notification qua trên PostgreSQL và Redis local. Có ca hai người nhận, tự bình luận, gộp người nhận, payload cũ, giao lại đồng thời, xóa trước tạo và tạo/xóa đồng thời.

## Cần xác minh trên staging

- Dùng tài khoản A bình luận hoặc trả lời trên Mobile và hai tài khoản nhận trên Web để đo độ trễ chuông, sau đó xóa bình luận và xác nhận inbox cập nhật.
- Chưa đo tải lớn hoặc diễn tập worker dừng giữa lúc xử lý. Push điện thoại thuộc task riêng.
