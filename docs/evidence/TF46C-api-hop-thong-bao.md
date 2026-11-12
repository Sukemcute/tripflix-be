# TF46C — API hộp thông báo

- SCRUM-80 · Nhánh `dung/TF46C-api-hop-thong-bao` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- Danh sách inbox hỗ trợ `tab=all|orders|interactions` và giữ phân trang theo cursor. Số chưa đọc luôn tính trên tất cả tab.
- `GET /notifications/unread-count` trả số chưa đọc của tài khoản đăng nhập.
- `POST /notifications/read-all` nhận `throughId` là ID thông báo mới nhất đã thấy. Server so sánh cặp `created_at, id` trong PostgreSQL và kiểm tra thông báo mốc thuộc người gọi. Client cũ có thể tiếp tục gọi với body rỗng.
- Hai thao tác đánh dấu đã đọc phát `notification.read` tới room riêng của người dùng. Web gửi mốc từ đầu danh sách và làm mới inbox khi nhận sự kiện.
- [OpenAPI Notification](../../contracts/openapi/notification.json)

## Kiểm tra

- Build, lint, typecheck và test Notification qua 32/32 tác vụ.
- Lint, typecheck và test affected của backend qua 49/49 tác vụ.
- 13/13 test tích hợp PostgreSQL và Redis qua. Test HTTP kiểm cả bốn endpoint, quyền của hai tài khoản, mốc ở độ chính xác microsecond và số chưa đọc sau thao tác.
- 31/31 test API client qua, gồm body mốc đọc và nhận `notification.read`. Kiểm tra kiểu Web và API client qua với mã TF46C và dependency frontend đã cài trên máy.

## Phạm vi

- API danh sách và đánh dấu đã đọc mở rộng inbox do Thắng triển khai. Triển khai backend trước frontend để mốc đọc có hiệu lực.
- Tab tương tác dành cho `comment.*` và `reaction.*`. Handler tạo các loại thông báo đó thuộc các task tiếp theo.
