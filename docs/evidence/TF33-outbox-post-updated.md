# TF33 — Phát sự kiện outbox content.post.updated khi sửa bài đã đăng

- Jira/Task: TF33 (Ẩn bài đồng bộ / Hàng chờ kiểm duyệt) · Nhánh: `thanh/TF33-outbox-post-updated` · Người làm: Thành (dùng AI: có) · Ngày: 2026-11-09

## Đã làm
- `UpdatePostUseCase`: Thêm decorator `@Transactional('content')` và inject `ContentOutbox` (optional để tương thích ngược unit test).
- Khi người dùng cập nhật bài viết mà trạng thái trước đó là `published` (`previousStatus === 'published'`), phát sự kiện outbox `content.post.updated` trong cùng transaction chứa `{ postId, authorId, title, body, status, updatedAt }`.
- Nếu bài viết ở trạng thái khác (ví dụ `draft`), không phát sự kiện `content.post.updated`.
- Bổ sung 2 unit test trong `social-use-cases.spec.ts` kiểm thử việc phát sự kiện khi sửa bài published và bỏ qua khi sửa bản nháp.
- Phục vụ cho hệ thống kiểm duyệt tự động và hàng chờ kiểm duyệt (TF32, TF33) của Trang quét lại nội dung sau khi chỉnh sửa.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Phát sự kiện `content.post.updated` khi sửa bài published | Có | Unit test `phát outbox content.post.updated khi sửa bài đã đăng (published)` trong `social-use-cases.spec.ts` |
| Không phát sự kiện khi sửa bài nháp (draft) | Có | Unit test `không phát outbox content.post.updated khi sửa bài nháp (draft)` trong `social-use-cases.spec.ts` |
| Ghi outbox trong cùng transaction DB | Có | `@Transactional('content')` trên `UpdatePostUseCase.execute` |

## Kết quả kiểm tra
- `pnpm --filter @tripflix/core-api typecheck`: sạch (0 lỗi).
- `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social`: 8 files, 124 passed.

## Cách kiểm lại
1. Chạy lệnh: `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social`
2. Quan sát 2 test case mới cho `UpdatePostUseCase` đều pass.

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng tiêu cực tới chức năng hiện tại: `outbox` là optional parameter trong constructor của `UpdatePostUseCase`, các use-case và test cũ vẫn chạy bình thường.
- Mở đường cho luồng quét kiểm duyệt TF32/TF33 của Trang.
