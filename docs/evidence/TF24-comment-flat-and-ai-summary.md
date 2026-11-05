# TF24 — Hỗ trợ AI Summary, Chế độ Flat Comments & Chuẩn hóa độ dài bình luận

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-comment-flat-and-ai-summary` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Chuẩn hóa độ dài bình luận (1 – 10.000 ký tự)**:
  - Bổ sung quy tắc kiểm tra trong Domain Entity `Comment.validateBody`: ném lỗi rõ ràng khi nội dung rỗng hoặc vượt quá 10.000 ký tự.
  - Tích hợp vào `AddCommentUseCase`, `EditCommentUseCase`, và Swagger DTO `CreateCommentDto`, `UpdateCommentDto`.
  - Ngăn ngừa tình trạng spam text vô hạn và bảo vệ context window cho mô hình LLM.
- **Hỗ trợ chế độ phẳng mọi cấp `flat=true` cho `GET /api/v1/posts/:postId/comments`**:
  - Thêm query parameter `flat?: boolean` (mặc định `false`).
  - Khi `flat=true`: Bỏ qua điều kiện lọc `parentCommentId IS NULL`, lấy toàn bộ bình luận gốc và câu trả lời/phản hồi con.
  - Mỗi phần tử trả về đã có sẵn `parentCommentId` để AI service dễ dàng phân tích cấu trúc thảo luận chỉ qua 1 lần phân trang duy nhất (giải quyết triệt để bài toán $1 + N$ queries).
  - Tăng kích thước trang tối đa lên **200 phần tử** khi `flat=true` (thay vì 50) để tối ưu I/O cho AI background worker.
  - Khi `flat=false` (mặc định cho Web & Mobile app): Giữ nguyên phân trang cho comment gốc.
- **Chuẩn hóa trường `total` trong phân trang bình luận**:
  - Khi `flat=true`: `total` trả về tổng toàn bộ bình luận của bài viết (`count(*)`), khớp 100% với danh sách phẳng.
  - Khi `flat=false` (mặc định): `total` đếm chính xác số lượng bình luận gốc (`parentCommentId IS NULL`) hoặc số phản hồi con của `parentCommentId` tương ứng.
- **Bảng lưu trữ kết quả tóm tắt `content.post_summaries`**:
  - Tạo schema Drizzle `postSummaries` trong schema `content`:
    - `post_id` (UUID, PK, FK -> `content.posts(id)` ON DELETE CASCADE)
    - `summary` (text, NOT NULL)
    - `key_takeaways` (jsonb, NOT NULL, mảng các ý nổi bật)
    - `input_hash` (varchar(128), bản băm tập bình luận)
    - `comment_count_at_summary` (integer, số bình luận lúc tóm tắt)
    - `created_at`, `updated_at` (timestamp with timezone)
  - Sinh và chạy migration Drizzle `20261105100001_rare_songbird`.
- **API lưu và đọc kết quả AI Summary**:
  - `PUT /api/v1/posts/:postId/ai-summary`: Endpoint nội bộ được bảo vệ bởi `@ServiceOnly('ai-service')` cho phép AI service dùng Service Token lưu/cập nhật kết quả tóm tắt.
  - `GET /api/v1/posts/:postId/ai-summary`: Endpoint công khai cho Web OTA và Mobile đọc trực tiếp kết quả tóm tắt đã lưu trong database mà không cần gọi LLM lúc người dùng mở xem bài.
- **Kiểm thử tự động**:
  - Thêm 10 tests trong `comment.entity.spec.ts` kiểm tra validate độ dài, rỗng, 1-level reply, cập nhật và xóa.
  - Thêm 11 tests trong `post-summary-and-flat-comments.spec.ts` kiểm tra use cases `AddCommentUseCase` (chặn > 10.000 ký tự), `ListCommentsUseCase` (flat mode, max limit 200, total), `SavePostSummaryUseCase`, `GetPostSummaryUseCase`, và `PostSummaryController`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chặn độ dài bình luận tối đa 10.000 ký tự | Đạt | `apps/core-api/src/modules/content/social/domain/comment.entity.ts`, test pass |
| Chế độ phẳng `flat=true` và limit 200 cho AI | Đạt | `apps/core-api/src/modules/content/social/application/use-cases/list-comments.use-case.ts`, `comment.repository.ts` |
| Chuẩn hóa `total` khớp với chế độ phân trang | Đạt | `CommentRepository.countByPostId`, test pass |
| Bảng `content.post_summaries` và migration | Đạt | `apps/core-api/src/modules/content/db/schema/post-summaries.ts`, migration `20261105100001_rare_songbird` |
| Endpoint `PUT /posts/:id/ai-summary` với `@ServiceOnly('ai-service')` và `GET` | Đạt | `apps/core-api/src/modules/content/social/api/post-summary.controller.ts` |
| Chất lượng mã nguồn (Quality Gate) | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (40 suites, 304/304 tests pass) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful (Pass 100%).
- `pnpm --filter @tripflix/core-api test -- post-summary-and-flat-comments.spec.ts comment.entity.spec.ts`: 21/21 tests pass.
- `pnpm test`: 40 test files pass, 304/304 tests pass.
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm db:migrate`
3. `pnpm --filter @tripflix/core-api test -- post-summary-and-flat-comments.spec.ts`
4. `pnpm check`

## Ảnh hưởng tới phần của người khác
- **Mở khóa phân hệ AI (Bảo)**: Bảo có thể gọi `GET /api/v1/posts/:id/comments?flat=true&limit=200` để lấy toàn bộ thảo luận dạng phẳng, và gọi `PUT /api/v1/posts/:id/ai-summary` bằng Service Token `ai-service` để lưu tóm tắt.
- **Frontend (Trang)**: Mặc định `flat=false` giữ nguyên tương thích 100% cho Web OTA và Mobile Reels. Đồng thời có thể gọi thêm `GET /api/v1/posts/:id/ai-summary` để hiển thị khung tóm tắt cộng đồng.
