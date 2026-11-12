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

## Lượt 2 — Inbox cho nhiều người nhận

- PR #148 đã merge và workflow deploy của commit `4cd6ccb` thành công. Người dùng báo luồng thông báo hiện tại hoạt động bình thường.
- Migration v2 bỏ unique cũ trên riêng `source_event_id`. Unique ghép theo sự kiện, người nhận và loại vẫn giữ. Dữ liệu inbox và migration v1 được giữ nguyên.
- Build, lint, typecheck và test qua 32/32 tác vụ. Bộ test tích hợp Notification qua 12/12 test, gồm ghi cho nhiều người và phát lại đồng thời.
- Kiểm tra thêm trên PostgreSQL local với migration v1 lấy từ commit `4cd6ccb`: nâng cấp lên v2, chạy lại v2 và khởi động lại bằng migration v1 đều thành công. Bản ghi đã đọc vẫn còn, câu lệnh insert của lượt 1 vẫn dùng được.
- Khi rollback sau v2, dùng image Notification Service của lượt 1 hoặc mới hơn. Image trước PR #148 còn phụ thuộc vào unique cũ.

## Ảnh hưởng tới phần của người khác

- Inbox do Thắng triển khai ban đầu. Migration tiếp tục chạy theo luồng khởi động hiện có của Notification Service.
