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
- **Hợp đồng**: thêm endpoint, `MarkPostSummaryCheckedDto`, `MarkPostSummaryCheckedResponseDto`, trường `checkedAt` trong `PostSummaryResponseDto` (chỉ thêm). `pnpm contracts:build`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| AI kiểm lại thấy không đổi thì bản tóm tắt hết "cũ" | Có | `mark-post-summary-checked.spec.ts` › có lần kiểm mới hơn: tính thay đổi từ checkedAt nên hết cũ |
| Không ghi đè bản tóm tắt mới hơn, không lùi mốc | Có | `post-summary.repository.int.spec.ts` (Postgres thật): hash lệch, mốc trễ, mốc trước generatedAt đều bỏ qua |
| Bản tóm tắt mới không mang mốc kiểm của bản cũ | Có | `post-summary.repository.int.spec.ts` › lưu bản mới thì xoá mốc kiểm |
| Chỉ ai-service gọi được, body sai bị chặn | Có | `post-summary.e2e.spec.ts` › PUT /checked: 200, `updated: false` khi hash lệch, 403 với video-worker, 400 khi body sai |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task; core-api 2327 test pass (1 skipped có sẵn); lint 0 lỗi, không có warning ở file đã sửa.
- `pnpm --filter @tripflix/core-api test:int src/modules/content/social/infra/post-summary.repository.int.spec.ts`: 5/5 pass (Testcontainers Postgres).

## Cách kiểm lại
1. Chạy migration content, lưu một bản tóm tắt bằng `PUT /v1/posts/:id/ai-summary` (token ai-service) với `inputHash: h1`.
2. Thêm một bình luận vào bài: `GET /v1/posts/:id/ai-summary` trả `isStale: true`.
3. Gọi `PUT /v1/posts/:id/ai-summary/checked` với `{ inputHash: "h1", checkedAt: <sau bình luận>, commentCount: <số bình luận hiện tại> }`: trả `{ updated: true }`, `GET` trả `isStale: false` và `checkedAt`.

## Ảnh / video
- Không có (không đổi giao diện).

## Ảnh hưởng tới phần của người khác
- `content/db` (dùng chung Phong, Thành, Trang): thêm một cột nullable vào `post_summaries`, không đổi cột cũ.
- `social/api/post-summary.e2e.spec.ts` (Trang viết): thêm `checkedAt: null` vào bản ghi giả và provider `MarkPostSummaryCheckedUseCase` để test chạy với constructor mới; thêm một ca e2e ở cuối.
- `tripflix-ai` (Bảo): cần gọi endpoint mới trong nhánh `run.request is None` của `summary_worker.py` với `checkedAt = started`, rồi sinh lại `app/contracts`.
