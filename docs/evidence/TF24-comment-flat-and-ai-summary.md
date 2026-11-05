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
  - **Bảng lưu trữ kết quả tóm tắt `content.post_summaries` & Migration chuẩn RULES §3 (dòng 51)**:
  - Schema Drizzle `postSummaries` trong schema `content`:
    - `post_id` (UUID, PK, FK `fk_post_summaries_post_id` -> `content.posts(id)` ON DELETE CASCADE)
    - `status` (varchar(32), NOT NULL, mặc định `'ready'`, hỗ trợ `'no_comments'`, `'insufficient_data'`, `'ready'`, `'failed'`)
    - `summary` (text, cho phép null khi chưa đủ dữ liệu)
    - `key_takeaways` (jsonb, NOT NULL, mảng các ý nổi bật)
    - `content` (jsonb, chứa phân tích khen/chê/video và thực tế/chủ đề kèm trích dẫn)
    - `safety` (jsonb, chứa cảnh báo an toàn và khối kiểm duyệt)
    - `input_hash` (varchar(128), bản băm tập bình luận)
    - `comment_count_at_summary` (integer, số bình luận lúc tóm tắt)
    - `prompt_version` (varchar(64))
    - `model_name` (varchar(64))
    - `generated_at` (timestamp with timezone)
    - `created_at`, `updated_at` (timestamp with timezone)
  - Giữ nguyên vẹn migration `20261105100001_rare_songbird` đã merge vào `develop`.
  - Sinh migration bổ sung mới `20261105100002_pretty_arachne` bằng `drizzle-kit generate` với rename hint:
    - Đổi tên constraint khóa ngoại sang `fk_post_summaries_post_id` theo chuẩn RULES §4.1.
    - `summary DROP NOT NULL` để cho phép null khi chưa có bình luận hoặc thiếu dữ liệu.
    - `ADD COLUMN` cho 7 trường mở rộng (`status`, `content`, `safety`, `prompt_version`, `model_name`, `generated_at`).
  - Chạy migration an toàn không xung đột trên bất kỳ môi trường nào đã chạy `rare_songbird`.
- **API lưu và đọc kết quả AI Summary & Bảo mật Service Token**:
  - `PUT /api/v1/posts/:postId/ai-summary`:
    - Bảo vệ bởi `@ServiceOnly('ai-service')` và xác thực Service Token audience `core-api`.
    - Dùng `ZodBody(SavePostSummaryRequestSchema)` để validate nghiêm ngặt payload, chặn dữ liệu sai cấu trúc trả 400 Bad Request (tránh văng lỗi 500 khi không có global ValidationPipe).
    - Thêm `.refine()` bắt buộc trường `summary` không được để trống khi `status === 'ready'`.
    - Dùng `ParseUUIDPipe` kiểm tra `postId` hợp lệ ngay tại tầng routing.
    - Chuẩn hóa toàn bộ schema DTO sang `camelCase` (`keyTakeaways`, `inputHash`, `commentCount`, `promptVersion`, `modelName`, `generatedAt`), đồng thời giữ fallback tương thích với `snake_case`.
    - Cấu hình tường minh `@ApiPropertyOptional({ type: String, nullable: true })` và `format: 'date-time'` giúp OpenAPI contract sinh đúng kiểu `string` (thay vì `object`) cho client generator phía Python của Bảo.
  - `GET /api/v1/posts/:postId/ai-summary`:
    - Endpoint công khai cho Web OTA và Mobile đọc trực tiếp kết quả tóm tắt đã lưu trong database mà không cần gọi LLM lúc người dùng mở xem bài.
    - Dùng `ParseUUIDPipe` cho param `postId`.
    - Trả về đầy đủ trạng thái, `inputHash` và thời gian sinh để AI worker tra cứu bỏ qua khi không đổi.
- **Kiểm thử E2E tích hợp Service Token (`post-summary.e2e.spec.ts`)**:
  - Bộ 9 tests E2E toàn diện:
    - `ai-service` với token hợp lệ: 200 OK và lưu tóm tắt thành công.
    - Chặn dữ liệu body sai kiểu bằng `ZodBody`: 400 Bad Request kèm chi tiết lỗi (không 500).
    - Bắt buộc `summary` khi `status === 'ready'`: 400 Bad Request nếu summary rỗng hoặc để trống.
    - Cho phép `summary` để trống khi `status` là `no_comments` hoặc `insufficient_data`: 200 OK.
    - Chặn `postId` sai định dạng UUID bằng `ParseUUIDPipe`: 400 Bad Request.
    - Token người dùng (member) bị từ chối ở API `@ServiceOnly`: 401 Unauthorized.
    - Service khác (`video-worker`) gọi API chỉ dành cho `ai-service`: 403 Forbidden.
    - Không gửi token: 401 Unauthorized.
    - GET bài viết đã có tóm tắt: 200 OK; bài viết chưa có tóm tắt: 404 Not Found.
- **Phát sự kiện Outbox cho vòng đời bình luận (phục vụ AI Worker gom tóm tắt)**:
  - `AddCommentUseCase`: Ghi outbox `content.comment.created` (đã có từ trước).
  - `EditCommentUseCase`: Bọc `@Transactional('content')`, ghi outbox `content.comment.updated` với payload `{ commentId, postId, authorId, parentCommentId, body, updatedAt }`.
  - `DeleteCommentUseCase`: Bọc `@Transactional('content')`, ghi outbox `content.comment.deleted` với payload `{ commentId, postId, authorId, parentCommentId, deletedBy, isSuperAdmin, deletedAt }`.
  - `ContentOutboxRelay`: Tự động định tuyến các sự kiện có tiền tố `content.*` vào `stream:core.content` (STREAMS.content).
- **Hợp đồng Event Schemas (`contracts/events/*.schema.json`)**:
  - Khai báo Zod schemas và xuất ra JSON Schema:
    - `contracts/events/content.comment.created.v1.schema.json`
    - `contracts/events/content.comment.updated.v1.schema.json`
    - `contracts/events/content.comment.deleted.v1.schema.json`
  - Đảm bảo AI worker của Bảo có thể validate dữ liệu trực tiếp khi consume Redis Streams.
- **Kiểm thử tự động**:
  - Thêm 10 tests trong `comment.entity.spec.ts` kiểm tra validate độ dài, rỗng, 1-level reply, cập nhật và xóa.
  - Thêm 11 tests trong `post-summary-and-flat-comments.spec.ts` kiểm tra use cases `AddCommentUseCase` (chặn > 10.000 ký tự), `ListCommentsUseCase` (flat mode, max limit 200, total), `SavePostSummaryUseCase`, `GetPostSummaryUseCase`, và `PostSummaryController`.
  - Bổ sung test kiểm tra `EditCommentUseCase` phát `content.comment.updated` và `DeleteCommentUseCase` phát `content.comment.deleted` trong `social-use-cases.spec.ts`.
  - Bổ sung kiểm tra định tuyến stream cho `content.comment.updated` và `content.comment.deleted` trong `content-outbox-relay.spec.ts`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chặn độ dài bình luận tối đa 10.000 ký tự | Đạt | `apps/core-api/src/modules/content/social/domain/comment.entity.ts`, test pass |
| Chế độ phẳng `flat=true` và limit 200 cho AI | Đạt | `apps/core-api/src/modules/content/social/application/use-cases/list-comments.use-case.ts`, `comment.repository.ts` |
| Chuẩn hóa `total` khớp với chế độ phân trang | Đạt | `CommentRepository.countByPostId`, test pass |
| Bảng `content.post_summaries` với FK `fk_post_summaries_post_id` và migration chuẩn | Đạt | `apps/core-api/src/modules/content/db/schema/post-summaries.ts`, migration `20261105100002_pretty_arachne` |
| Endpoint `PUT /posts/:id/ai-summary` với `@ServiceOnly('ai-service')`, `ZodBody`, `ParseUUIDPipe` | Đạt | `apps/core-api/src/modules/content/social/api/post-summary.controller.ts` |
| DTO camelCase chuẩn hóa và mở rộng cho AI Service | Đạt | `apps/core-api/src/modules/content/social/api/dto/post-summary.dto.ts` |
| Bộ E2E kiểm thử Service Token thật | Đạt | `apps/core-api/src/modules/content/social/api/post-summary.e2e.spec.ts` (9/9 tests pass) |
| Outbox events `comment.updated` & `comment.deleted` | Đạt | `EditCommentUseCase`, `DeleteCommentUseCase`, tests pass |
| JSON Schemas cho comment events | Đạt | `contracts/events/content.comment.*.v1.schema.json`, `libs/contracts` |
| Chất lượng mã nguồn (Quality Gate) | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (48 suites, 352/352 tests pass in core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful (Pass 100%).
- `pnpm --filter @tripflix/core-api test -- post-summary-and-flat-comments.spec.ts comment.entity.spec.ts social-use-cases.spec.ts`: All tests pass.
- `pnpm test`: 40 test files pass, 305/305 tests pass in core-api, toàn bộ mono-repo pass.
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json` và 13 JSON Schemas.

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm db:migrate`
3. `pnpm --filter @tripflix/core-api test -- post-summary-and-flat-comments.spec.ts`
4. `pnpm check`

## Ảnh hưởng tới phần của người khác
- **Mở khóa phân hệ AI (Bảo)**: Bảo có thể gọi `GET /api/v1/posts/:id/comments?flat=true&limit=200` để lấy toàn bộ thảo luận dạng phẳng, và gọi `PUT /api/v1/posts/:id/ai-summary` bằng Service Token `ai-service` để lưu tóm tắt.
- **Frontend (Trang)**: Mặc định `flat=false` giữ nguyên tương thích 100% cho Web OTA và Mobile Reels. Đồng thời có thể gọi thêm `GET /api/v1/posts/:id/ai-summary` để hiển thị khung tóm tắt cộng đồng.
