# TF25 — Trả lời kiểu TikTok có khung trích dẫn — BE (`content/social`)

- Phạm vi: Phần 1 trong `reply-quote.md` · Nhánh: `thanh/TF25-tra-loi-trich-dan` (worktree `wt-be-migfix`, từ `origin/develop`) · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-19

## Đã làm
1. **DTO & OpenAPI (`apps/core-api/src/modules/content/social/api/dto/response.dto.ts`, `contracts/openapi/core-api.json`):**
   - Chỉ thêm 2 trường vào `SocialCommentDto`: `replyToCommentId: string | null` và `replyToExcerpt: string | null` (giữ nguyên `replyToName`).
   - Sinh lại OpenAPI bằng `pnpm contracts:build`.
2. **Helper trích dẫn thuần (`apps/core-api/src/modules/content/social/application/common/reply-excerpt.ts`):**
   - `formatReplyExcerpt`: chuẩn hoá khoảng trắng và cắt tối đa `120` ký tự Unicode (`Array.from`, không cắt đôi surrogate pair / emoji).
   - `isPublicReplyTarget`: trả `false` (khiến `replyToExcerpt = null`) nếu câu được trả lời đã xoá (`deletedAt`), bị ẩn/gỡ (`status` là `hidden`/`removed`), đang bị giữ (`status = 'held'`, `platformHeld = true`, hoặc `creatorReview !== 'approved'`), hoặc khác `postId`.
3. **Nạp excerpt theo lô không N+1 (`comment.repository.ts`, `list-comments.use-case.ts`, `add-comment.use-case.ts`, `edit-comment.use-case.ts`):**
   - Thêm `CommentRepository.findByIds(postId, ids)` đọc một truy vấn `WHERE post_id = $1 AND id IN (...)`.
   - `ListCommentsUseCase` (`execute` cho cả list gốc/replies/flat và `enrich` cho `focusCommentId`) gom các `replyToCommentId` trên trang và gọi `findByIds` tối đa 1 lần.
   - `AddCommentUseCase` và `EditCommentUseCase` trả kèm `replyToCommentId` và `replyToExcerpt` ngay trong response tạo/sửa.
4. **Thứ tự replies ASC + index một phần + migration (`comment.repository.ts`, `db/schema/comments.ts`, `db/migrations/20261119071220_stormy_prowler/migration.sql`):**
   - Khi `!options.flat && options.parentCommentId`: `findPage` và `findByPostId` sắp `created_at ASC, id ASC` và phân trang keyset bằng `isAfterCursor` (bình luận gốc giữ nguyên `DESC` + `isBeforeCursor`).
   - Thêm partial index `idx_comments_parent_created_asc` (`parent_comment_id, created_at ASC, id ASC, status, author_id WHERE deleted_at IS NULL`) trong `schema/comments.ts` và sinh migration bằng `pnpm --filter @tripflix/core-api db:generate content`, đầu file có `SET LOCAL lock_timeout = '5s';`. Không chạy `db:migrate`.
5. **Unit tests (`apps/core-api/src/modules/content/social/application/use-cases/reply-quote.spec.ts`, 8 tests):**
   - Kiểm cắt 120 ký tự Unicode an toàn với emoji/surrogate pair, `isPublicReplyTarget` trả `null` khi xoá/ẩn/giữ/creator pending, `findByIds` chỉ gọi 1 lần cho cả trang và focus thread (không N+1), reply cũ không có `replyToCommentId` trả `null`, thứ tự `ASC` + cursor trang 2 nối đúng, và `AddCommentUseCase` trả ngay `replyToCommentId` + `replyToExcerpt`.

## Kết quả kiểm tra
- `pnpm --filter @tripflix/core-api lint` & `typecheck`: **0 errors** (kiểm tra biên giới module pass).
- `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social`: **21/21 test files pass (316/316 tests pass)**, gồm `reply-quote.spec.ts` (`8/8 pass`).
- `pnpm --filter @tripflix/core-api exec vitest run --maxWorkers=2`: **175 passed | 2 skipped (177 files)**, **3020 passed | 4 skipped (3024 tests)**, 0 failures (2 file skipped có sẵn trong repo: `explore.parity.spec.ts`, `typo-bench.spec.ts`).

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api lint && pnpm --filter @tripflix/core-api typecheck`
2. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social`

## Ảnh / video
- Không áp dụng (thay đổi backend).

## Ảnh hưởng tới phần của người khác
- Chỉ sửa trong `apps/core-api/src/modules/content/social/*`, `apps/core-api/src/modules/content/db/*` (thêm partial index), và `contracts/openapi/core-api.json` (chỉ thêm field tương thích ngược trên `SocialCommentDto`). Không sửa `libs/contracts/` hay module của thành viên khác.
