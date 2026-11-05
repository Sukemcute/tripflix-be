# TF25 — Tương tác bài đăng trên app và web

- Notion: https://notion.so/tripflix/TF25 · Nhánh: `thanh/TF02-social-content` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- Hiện thực toàn bộ API tương tác thời gian thực:
  - Cảm xúc (`PUT /v1/posts/:id/reaction`, `GET /v1/posts/:id/reaction`) với tính năng toggle idempotent, cập nhật trực tiếp atomic counters trong JSONB `reaction_counts` trên Postgres schema `content`.
  - Thống kê tổng hợp (`GET /v1/posts/:id/stats`): lấy số lượt xem, like, comment, share, bookmark.
  - Bình luận (`POST /v1/posts/:id/comments`, `GET /v1/posts/:id/comments`, `PATCH /v1/comments/:id`, `DELETE /v1/comments/:id`): hỗ trợ phân cấp 1 cấp phản hồi (`parent_comment_id`), giới hạn độ sâu tối đa 1 level, xóa mềm giữ chỗ cây thảo luận, cập nhật `comment_count`.
  - Lưu bài viết bookmark (`PUT /v1/posts/:id/bookmark`, `GET /v1/me/bookmarks`): lưu bài viết để xem offline và quản lý danh sách cá nhân.
- Phát sự kiện Outbox `content.reaction.updated`, `content.comment.added` phục vụ phân hệ Feed tính điểm xếp hạng xu hướng.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Thả/đổi/hủy cảm xúc idempotent không tạo bản ghi rác, tự động cập nhật atomic counter | Đạt | `SetReactionUseCase`, test `Reaction toggle logic` pass |
| Thống kê tương tác real-time đầy đủ các chỉ số | Đạt | `GetPostStatsUseCase`, test `GET /posts/:id/stats` pass |
| Bình luận phân cấp 1-level, xóa mềm và phân trang cursor | Đạt | `AddCommentUseCase`, `EditCommentUseCase`, `DeleteCommentUseCase`, tests pass |
| Lưu bài viết và xem danh sách bookmark cá nhân | Đạt | `BookmarkPostUseCase`, `ListBookmarksUseCase`, tests pass |
| 100% Lint, Typecheck, Unit Test pass | Đạt | `pnpm check` (62/62 tests pass) |

## Kết quả kiểm tra
- `pnpm lint`: 0 warnings, 0 errors.
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm typecheck`: Thành công trên toàn bộ workspace monorepo.
- `pnpm test`: 62/62 tests pass.

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm check`
3. `pnpm contracts:build`

## Ảnh / video
- Đợt cập nhật Backend Core API & Contracts: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không: Dữ liệu lưu độc lập trong schema `content`, cung cấp event bus cho Feed.
