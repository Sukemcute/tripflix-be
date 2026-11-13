# TF46 — Inbox dùng chung cho tác giả đông follower

- Bật thử bằng `FOLLOWER_SHARED_THRESHOLD` trên Notification Service, ví dụ `10000`. Mặc định chưa bật. Ngưỡng là cấu hình thử nghiệm, chưa phải kết luận tải staging.
- Worker hỏi Core ở lô đầu. Dưới ngưỡng vẫn ghi từng lô. Đạt ngưỡng chỉ cập nhật một job thành bản ghi dùng chung. Job đã có cursor tiếp tục luồng đang chạy.
- Notification lưu bản sao quan hệ follow từ outbox. Inbox dùng quan hệ hiện có và thời điểm follow để lọc bài. Đọc, phân trang, badge và đánh dấu đã đọc dùng chung thứ tự với inbox cá nhân.
- Hủy job khi bài bị ẩn, gỡ, xóa hoặc riêng tư làm biến mất bản ghi dùng chung. Không có push hoặc email trong thay đổi này.

## Triển khai

- Triển khai producer follow/unfollow của Core và consumer Notification trước. Giữ ngưỡng tắt cho tới khi backfill các quan hệ follow có trước khi triển khai hoặc xác nhận môi trường chưa có follow cũ. Code hiện chưa có lệnh backfill tự động.
- Kiểm luồng có một follower cũ, một follower mới, một người đã unfollow, và một người không follow. So sánh badge, phân trang và read-all trên Web và Mobile.
- Cần đo truy vấn inbox của người theo dõi nhiều tác giả, và đo tải staging trước khi bật rộng.

## Kiểm thử

- Build contracts thành công. 49/49 tác vụ lint, typecheck và test.
- 33/33 test tích hợp Notification và 1/1 test repository follow trên PostgreSQL.
- Chưa đo truy vấn của thiết kế mới với 1 triệu follower trên staging.
