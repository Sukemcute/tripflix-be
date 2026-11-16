# TF46 — Theo dõi bài đã bình luận (N1)

- Notion: TF46 (N1 theo yêu cầu của anh Thành) · Nhánh: `dung/TF46-theo-doi-bai-da-binh-luan` (phụ thuộc PR #197) · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Migration notification số 9: bảng `post_watchers (post_id, user_id, is_muted, changed_at)` và `post_watch_jobs` (mỗi bình luận gốc một job, có `cursor`, `attempts`, `available_at`).
- Từ `content.comment.created`: người bình luận (gốc hoặc trả lời) được ghi vào `post_watchers`, trong cùng transaction và khoá với N2. Người đã tắt theo dõi giữ nguyên trạng thái khi bình luận lại.
- Bình luận gốc xếp job. `PostWatchWorker` chạy mỗi 500 ms, mỗi lượt một lô 200 người theo `user_id`, thử lại có giãn cách khi lỗi, giống `follower_post_jobs`. Dữ liệu người theo dõi nằm ở database notification nên không gọi sang core.
- Người nhận: người theo dõi chưa tắt, trừ chủ bài (đã có `comment.created`) và người viết. Trả lời trong luồng không tạo job vì N2 đã báo người trong luồng.
- Loại mới `comment.watched_post`, gom mỗi người một dòng theo bài khi chưa đọc: "B và N người khác đã bình luận bài bạn theo dõi." Cập nhật cả lô bằng 2 câu SQL (cập nhật dòng chưa đọc, tạo dòng mới cho người chưa có).
- Bình luận bị xoá/ẩn hoặc bài bị kiểm duyệt trước khi job chạy: job chuyển `cancelled`, không ai nhận.
- API: `GET /notifications/posts/:postId/watch` → `{ isWatching, canChange }`; `PUT /notifications/posts/:postId/watch` body `{ isWatching: boolean }`. Chỉ người đã bình luận bài mới đổi được (404 nếu chưa), để không ai tự theo dõi bài private để xem tên người bình luận.
- Chỉ tính từ lúc triển khai, không backfill.

## Đối chiếu "Xong khi"
| Tiêu chí (theo yêu cầu anh Thành) | Đạt | Bằng chứng |
|---|---|---|
| Có bình luận gốc mới thì người từng bình luận bài nhận, trừ chủ bài và người viết | Có | `post-watch.int.spec.ts` — "báo bình luận gốc mới cho người từng bình luận…" |
| Bài đông người phát theo lô như `follower_post_jobs` | Có | "bài đông người chia lô theo user_id…" (450 người, 3 lô, mỗi người đúng một dòng) |
| Gom "B và N người khác…" khi chưa đọc | Có | "gom mỗi người một lần khi chưa đọc, đọc rồi thì tạo dòng mới" |
| API tắt và bật theo dõi một bài | Có | "tắt theo dõi thì không nhận, bình luận lại vẫn giữ trạng thái tắt; chưa bình luận thì không đổi được" |
| Không báo bình luận đã xoá | Có | "xoá bình luận trước khi job chạy thì huỷ job, không ai nhận" |

## Kết quả kiểm tra
- `vitest run --config vitest.int.config.ts` (notification-service, Postgres thật qua Testcontainers): 9 file, 42/42 pass.
- `vitest run` (notification-service): 16 file, 112/112 pass.
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass.

## Cách kiểm lại
1. Bật Docker.
2. `cd apps/notification-service && npx vitest run --config vitest.int.config.ts src/inbox/post-watch.int.spec.ts`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Chỉ sửa `notification-service` (Dũng).
- Web (Thành): làm nút theo dõi bằng hai API trên; loại `comment.watched_post` mở qua `link` `/trips/<postId>?comment=<id>`.
- Giới hạn: worker không phát realtime (giống thông báo bài mới của follower), người dùng thấy khi mở/tải lại inbox. Bài chuyển sang private sau đó thì người theo dõi cũ vẫn nhận, vì notification chưa biết quyền xem của bài (N2 cũng vậy).
