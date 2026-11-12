# TF46A — Schema Notification, lượt 1

- Task SCRUM-78 · Nhánh `dung/TF46A-schema-notification` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- Thêm migration có phiên bản trong database `notification`. Migration và bản ghi lịch sử chạy trong một transaction có advisory lock để nhiều replica khởi động cùng lúc.
- Giữ dữ liệu và chỉ mục inbox hiện có. Thêm `group_key`, chỉ mục unique theo sự kiện, người nhận và loại, cùng các bảng `deliveries`, `user_directory`, `post_directory`.
- Giữ unique cũ theo `source_event_id` trong lượt này để image cũ còn ghi được khi rollback. Repository mới dùng `ON CONFLICT DO NOTHING` để tương thích với cả hai cấu trúc index.
- Lệnh `pnpm db:migrate` chạy thêm migration Notification bằng role của service. Notification Service cũng chạy cùng migration khi khởi động để tương thích với luồng deploy hiện tại.

## Kiểm tra

- Build, lint và typecheck Notification Service qua. Bộ test thường qua 105 test.
- Bộ test tích hợp Notification qua 11 test trên PostgreSQL, trong đó có 7 test inbox. Test bao gồm nâng cấp từ bảng cũ có dữ liệu, hai lần khởi tạo song song, chạy lại migration và thử câu lệnh insert của image cũ.
- Chạy CLI migration hai lần trên database Notification mới. Cả hai lần thành công và lịch sử chỉ có một bản ghi migration.

## Phần còn lại

- Sau khi image tương thích đã được kiểm chứng trên staging, tạo migration riêng để bỏ unique cũ và kiểm tra một sự kiện tạo được thông báo cho nhiều người nhận.
- Inbox do Thắng triển khai ban đầu. Migration tiếp tục chạy theo luồng khởi động hiện có của Notification Service.
