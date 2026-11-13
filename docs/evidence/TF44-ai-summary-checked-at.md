# TF44 — Tóm tắt AI không bị coi là "cũ" mãi khi đầu vào không đổi

- Jira: TF44 (AI summary) · Nhánh: `thanh/TF44-ai-summary-checked-at` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-13

## Bối cảnh
Bảo báo (2026-11-13): `isStale = countMismatch || discussionChanged`, với `discussionChanged` tính từ `generatedAt`. Worker AI chạy lại mà `inputHash` trùng bản đang lưu thì cố ý không lưu (khỏi gọi LLM), nên `generatedAt` đứng yên. Ví dụ một bình luận chỉ có emoji: luật bên AI lọc bỏ, hash không đổi, không lưu; nhưng `posts.comment_count` đã tăng và bình luận đó tạo sau `generatedAt`, nên cả hai điều kiện đều đúng mãi.

Bỏ `discussionChanged` (cách 1 Bảo đề xuất) không đủ: `comment_count_at_summary` cũng chỉ cập nhật khi lưu, nên `countMismatch` vẫn kẹt. Chọn cách 2: AI báo "đã kiểm, không đổi".

## Đã làm
- **Cột mới** `content.post_summaries.checked_at` (nullable), migration `20261113042234_post_summary_checked_at` chỉ có `ADD COLUMN`.
- **Endpoint** `PUT /v1/posts/:postId/ai-summary/checked` (`@ServiceOnly('ai-service')`), body `{ inputHash, checkedAt, commentCount }`, trả `{ updated }`.
- **Cập nhật có điều kiện** (`PostSummaryRepository.markChecked`): chỉ khi `input_hash` khớp bản đang lưu, `generated_at <= checkedAt` và `checked_at` hiện có cũ hơn. Lệnh đến trễ hay lệnh của bản cũ không làm gì; gửi lại nhiều lần không sao. Ghi `checked_at` và `comment_count_at_summary`, không đụng nội dung.
- **Lưu bản tóm tắt mới** (`saveIfNewer`) đặt lại `checked_at = null`.
- **`isStale`**: `discussionChanged` tính từ `max(generatedAt, checkedAt)`; vẫn giữ so sánh số bình luận (bắt bình luận bị sửa trong lúc AI còn chờ gom sự kiện).
- **Đối soát an toàn với id lạ** (Bảo báo): câu `findHeldSummaryPostIds` ép `src.id::uuid` trong `ON ... AND ...`; Postgres không đảm bảo thứ tự tính các vế của `AND`, nên một id không phải UUID trong `source_comment_ids` (dòng cũ, trước khi API kiểm UUID) có thể làm cả câu lỗi. Đổi sang `c.id = CASE WHEN src.id ~* '<uuid>' THEN src.id::uuid END`: id lạ thành NULL, bị coi là nguồn đã mất.
- **Hợp đồng**: thêm endpoint, `MarkPostSummaryCheckedDto`, `MarkPostSummaryCheckedResponseDto`, trường `checkedAt` trong `PostSummaryResponseDto` (chỉ thêm). `pnpm contracts:build`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| AI kiểm lại thấy không đổi thì bản tóm tắt hết "cũ" | Có | `mark-post-summary-checked.spec.ts` › có lần kiểm mới hơn: tính thay đổi từ checkedAt nên hết cũ |
| Không ghi đè bản tóm tắt mới hơn, không lùi mốc | Có | `post-summary.repository.int.spec.ts` (Postgres thật): hash lệch, mốc trễ, mốc trước generatedAt đều bỏ qua |
| Bản tóm tắt mới không mang mốc kiểm của bản cũ | Có | `post-summary.repository.int.spec.ts` › lưu bản mới thì xoá mốc kiểm |
| Đối soát không lỗi khi có id không phải UUID | Có | `post-summary.repository.int.spec.ts` › đối soát không lỗi khi sourceCommentIds có id không phải UUID |
| Chỉ ai-service gọi được, body sai bị chặn | Có | `post-summary.e2e.spec.ts` › PUT /checked: 200, `updated: false` khi hash lệch, 403 với video-worker, 400 khi body sai |

## Kết quả kiểm tra
- Sau khi merge `origin/develop` (2026-11-13): `pnpm turbo run lint typecheck test --affected`: 49/49 task; core-api 2331 test pass (1 skipped có sẵn); lint 0 lỗi, không có warning ở file đã sửa. `drizzle-kit check` và `pnpm db:generate content` báo không lệch schema.
- `pnpm --filter @tripflix/core-api test:int src/modules/content/social/infra/post-summary.repository.int.spec.ts`: 6/6 pass (Testcontainers Postgres). Ca id lạ kiểm kết quả đúng sau khi sửa; lỗi gốc phụ thuộc thứ tự planner chọn nên không chắc tái hiện được trên bản cũ.

## Cách kiểm lại
1. Chạy migration content, lưu một bản tóm tắt bằng `PUT /v1/posts/:id/ai-summary` (token ai-service) với `inputHash: h1`.
2. Thêm một bình luận vào bài: `GET /v1/posts/:id/ai-summary` trả `isStale: true`.
3. Gọi `PUT /v1/posts/:id/ai-summary/checked` với `{ inputHash: "h1", checkedAt: <sau bình luận>, commentCount: <số bình luận hiện tại> }`: trả `{ updated: true }`, `GET` trả `isStale: false` và `checkedAt`.

## Ảnh / video
- Không có (không đổi giao diện).

## Ảnh hưởng tới phần của người khác
- `content/db` (dùng chung Phong, Thành, Trang): thêm một cột nullable vào `post_summaries`, không đổi cột cũ.
- `social/api/post-summary.e2e.spec.ts` (Trang viết): thêm `checkedAt: null` vào bản ghi giả và provider `MarkPostSummaryCheckedUseCase` để test chạy với constructor mới; thêm một ca e2e ở cuối.
- Đã trả lời Bảo các câu hỏi về endpoint: đường dẫn có tiền tố `/api`; luôn 200 kèm `updated` (không có 409); `checkedAt` phải dạng `...Z` (`+00:00` bị 400). `posts.comment_count` chỉ đếm bình luận đang hiện, cùng định nghĩa với `visibleCommentCount`.
- Sự kiện `content.comment.restored` thiếu `body` thuộc code moderation của Trang: chưa sửa, Bảo nhắn Trang.
- `tripflix-ai` (Bảo): cần gọi endpoint mới trong nhánh `run.request is None` của `summary_worker.py` với `checkedAt = started`, rồi sinh lại `app/contracts`.
