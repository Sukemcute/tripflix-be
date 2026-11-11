# TF33 — Lấy mẫu bình luận ngẫu nhiên có kiểm soát & Đối soát tóm tắt AI

- Notion: https://notion.so/tripflix/TF33 · Nhánh: `thanh/TF33-lay-mau-binh-luan-va-doi-soat-ai` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-11

## Đã làm
- **API lấy mẫu bình luận ngẫu nhiên có kiểm soát (`GET /api/v1/posts/:postId/comments/sample`)**:
  - Bảo vệ bởi `@ServiceOnly('ai-service')`.
  - Hỗ trợ tham số `size` (1 - 5.000, mặc định 1.000) và `seed` đảm bảo tính tái lập (deterministic).
  - Sử dụng thuật toán băm xác định `ORDER BY hashtext(id::text || :seed) LIMIT :size` trên các bình luận có `status = 'visible'` và `deleted_at IS NULL`.
  - Trả về metadata thống kê `stats: { visibleCommentCount, uniqueAuthorCount }` chính xác từ Core để phục vụ ước lượng thống kê.
  - Mỗi phần tử bình luận trả về đầy đủ: `id`, `postId`, `authorId`, `body`, `parentCommentId`, `parentCommentBody` (thực hiện qua `LEFT JOIN` và kiểm tra hiển thị), `likeCount`, `createdAt`, `editedAt` (thời điểm cập nhật nếu đã sửa).
- **API đối soát tóm tắt bị giữ lại (`GET /api/v1/internal/ai-summary/reconciliation`)**:
  - Bảo vệ bởi `@ServiceOnly('ai-service')`.
  - Quét danh sách các bài viết có tóm tắt đang bị giữ lại (held) do nguồn `sourceCommentIds` chứa bình luận bị ẩn/xoá mà chưa có bản tóm tắt mới.
  - Hỗ trợ phân trang Keyset Cursor theo `postId` (mặc định 50 bài, tối đa 200 bài).
  - Trả về `{ postIds: string[], nextCursor: string | null, total: number }`.
- **Kiểm thử tự động**:
  - Bổ sung bộ test suite riêng `comment-sampling-and-reconciliation.spec.ts` kiểm thử toàn diện các use case và controller.
  - Vượt qua 100% boundary check (`check-boundaries.mjs`).

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| API lấy mẫu ngẫu nhiên có kiểm soát `GET /posts/:id/comments/sample` | Đạt | `comment-sampling-and-reconciliation.spec.ts` |
| Hỗ trợ size (1-5000), seed tái lập, bảo mật `@ServiceOnly('ai-service')` | Đạt | `comment-sampling-and-reconciliation.spec.ts` |
| Payload đầy đủ likeCount, parentCommentBody, editedAt | Đạt | `comment-sampling-and-reconciliation.spec.ts` |
| Endpoint đối soát `GET /internal/ai-summary/reconciliation` có phân trang cursor | Đạt | `comment-sampling-and-reconciliation.spec.ts` |
| Không vi phạm ranh giới kiến trúc module | Đạt | `node tripflix-be/tools/check-boundaries.mjs` pass |

## Kết quả kiểm tra
- `vitest run "comment-sampling-and-reconciliation"`: 10/10 tests pass.
- `vitest run` toàn bộ core-api: 77 files, 2.101 unit tests pass.
- `node tripflix-be/tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `tsc -p tsconfig.json --noEmit`: 0 lỗi typecheck.
- `nest build`: Build thành công.

## Cách kiểm lại
1. Chạy test: `pnpm --filter @tripflix/core-api test comment-sampling-and-reconciliation`
2. Chạy boundary check: `node tripflix-be/tools/check-boundaries.mjs`
3. Chạy typecheck: `pnpm --filter @tripflix/core-api typecheck`

## Ảnh hưởng tới phần của người khác
- Không: Chỉ bổ sung endpoints nội bộ cho AI service và các use case trong phân hệ `content/social` do Thành trực tiếp phụ trách. Phối hợp với Bảo (AI service) qua service token.
