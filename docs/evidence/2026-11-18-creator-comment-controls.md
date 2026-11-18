# Bình luận bị giữ và bộ lọc của chủ bài

Ngày kiểm tra: 18/11/2026. Nhánh BE/FE: `feature/creator-comment-controls`.

## Phạm vi đã triển khai

- Chủ bài bật/tắt bình luận từng bài và đặt tối đa 50 từ/cụm từ, mỗi mục tối đa 80 ký tự.
- Matching bỏ dấu tiếng Việt, phân biệt ranh giới từ, không phân biệt hoa thường. Ví dụ `đặt cọc` khớp `ĐẶT CỌC`; không khớp một phần của từ dài hơn. Không chấp nhận mục chỉ có dấu câu.
- Bộ lọc áp dụng khi đăng/sửa tiếp theo. Chủ bài bỏ qua bộ lọc của chính mình. Thay đổi cài đặt không tự công khai bình luận đang bị giữ.
- Hàng chờ riêng chỉ chủ bài đọc và quyết định. Vai trò moderator không thay quyền sở hữu.
- Bình luận bị giữ không tăng số đếm công khai và không phát sự kiện `created` cho đến lần đầu đủ điều kiện hiển thị.
- Duyệt lặp cùng quyết định an toàn; đổi quyết định đã xử lý trả 409. Tác giả tự xóa thì bình luận rời hàng chờ.

## Tách quyền của chủ bài và nền tảng

`comments.status` vẫn là trạng thái hiệu lực dùng cho public SQL/counters. Thêm `creatorReview` (`approved/pending/rejected`), `platformHeld` và `publishedAt` để giữ nguồn hạn chế độc lập.

- Chủ bài approve chỉ gỡ hạn chế của chủ bài; không vượt platform hold, hidden/removed, parent không hiển thị hoặc bài không được công khai.
- Nền tảng restore không vượt creator pending/rejected. Reply bị giữ theo bình luận gốc cũng chưa được nhả trước gốc.
- Creator reject không tạo vi phạm nền tảng, strike hay quyền khiếu nại nền tảng.
- AI gắn cờ bình luận đang bị bộ lọc giữ phải ghi platform hold trước khi chủ bài có thể công khai.
- Khôi phục nền tảng nhưng kết quả vẫn held không gửi thông báo “đã hiển thị trở lại”. Event decision có trường tùy chọn `resultingStatus`, tương thích consumer cũ.
- Danh sách keyword không xuất hiện trong các API đọc bài công khai.

## API

| Method | Đường dẫn sau `/api` | Quyền |
|---|---|---|
| GET | `/v1/posts/:id/comment-permissions` | Người được xem bài, gồm khách nếu public |
| GET/PATCH | `/v1/posts/:id/comment-settings` | Chủ bài |
| GET | `/v1/posts/:id/filtered-comments?cursor=0&limit=20` | Chủ bài; limit 1–50 |
| POST | `/v1/comments/:id/creator-decisions` | Chủ bài; `{decision: approve/reject}`; HTTP 200 |
| GET | `/v1/me/posts?status=held` | Tác giả; dùng tìm lại bài đang giữ |

PATCH và POST decision dùng cơ chế idempotency có sẵn. Tắt bình luận trả 403 với `code=comments_disabled`; kiểm quyền xem bài diễn ra trước thông báo này để không lộ bài riêng tư.

## Dữ liệu và triển khai

Hai migration additive trong module content:

1. `20261118035214_wild_fantastic_four`: settings trên posts; creator review/platform hold trên comments; backfill comment held cũ thành platform hold.
2. `20261118035548_material_namora`: published_at của comments; backfill bình luận đã từng hiển thị để không gửi trùng thông báo khi restore.

Chạy migration trước bản BE mới. BE cũ vẫn hoạt động với các cột thêm. Khi rollback code, giữ các cột và dữ liệu này. Không tự đổi held thành visible.

## Bằng chứng tự động

- Core API: 2.795 test đạt, 4 test bỏ qua có sẵn; chạy với `--maxWorkers=4`. Một test seed timeout khi chạy quá nhiều worker đồng thời, đã chạy riêng đạt 7/7 và toàn suite giới hạn worker đạt.
- Moderation integration: 45 test đạt trên PostgreSQL thật, bao gồm migration, rollback outbox, approve đồng thời, counter, cascade, AI/platform hold, reject/delete/pagination và quyền bài private.
- Toàn bộ integration module content: 122 test / 16 file đạt, gồm đường ghi bình luận đông và held visibility.
- Notification: 12 test đạt, gồm hai đường không báo restore khi vẫn held.
- Core API và notification typecheck đạt; Core build và export OpenAPI đạt. Lint không có lỗi, còn warning của repo. Kiểm tra ranh giới module và `git diff --check` đạt.
- Live Web/API qua gateway local: settings/queue kiểm quyền, validation 51 keyword, không lộ keyword, held không hiện cho khách, approve đúng count, tắt/bật giữ draft, giao diện 1440/390px và thông báo held sau đăng bài. Không mock API.

Xem hướng dẫn thử và giới hạn thiết bị trong tài liệu FE cùng tên.
