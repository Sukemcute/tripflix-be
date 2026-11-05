# TF24 — Bổ sung ContentFacade.listPosts phục vụ đồng bộ chỉ mục Discovery & Search

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-facade-list-posts` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Bổ sung `ContentFacade.listPosts`**:
  - Triển khai phương thức `listPosts(query: ListPostsFacadeQuery): Promise<ListPostsFacadeResult>` trên `ContentFacade` để module `discovery` (Duy) và `feed` (Phong) có thể đồng bộ định kỳ danh sách bài viết công khai sang chỉ mục tìm kiếm `/search/posts`.
  - Tham số đầu vào:
    - `updatedAfter?: Date | string | null`: Chỉ lấy các bài viết có `updatedAt >= updatedAfter` (phục vụ CDC / incremental polling).
    - `cursor?: string | null`: Keyset cursor phân trang dạng Base64URL.
    - `limit?: number`: Số bài viết mỗi trang (1–100, mặc định 50).
  - Kết quả trả về:
    - `items: VisiblePostSummary[]`: Danh sách bài viết công khai (`status = published`, `visibility = public`, chưa xóa mềm `!deletedAt`).
    - `nextCursor: string | null`: Cursor cho trang tiếp theo, tự động sinh từ bài cuối cùng khi còn dữ liệu.
- **Bảo mật & PII Masking**:
  - Dữ liệu trả về qua Facade được tự động ẩn `bookingId` riêng tư trong `tripAttachment` và đính kèm `priceDisclaimer` theo quy chuẩn PRD F5.
- **Keyset Cursor Pagination theo `updatedAt ASC, id ASC`**:
  - Mở rộng `social/application/common/cursor.ts` với hai hàm `encodeSyncCursor` và `decodeSyncCursor` hỗ trợ timestamp `updatedAt`.
  - Bổ sung phương thức `findPostsForSync` trong `PostRepository` với điều kiện lọc `gte(posts.updatedAt, updatedAfter)` và sắp xếp `asc(posts.updatedAt), asc(posts.id)`.
- **Public API & Export**:
  - Export `ListPostsFacadeQuery` và `ListPostsFacadeResult` tại `apps/core-api/src/modules/content/index.ts`.
- **Kiểm thử**:
  - Thêm 2 unit tests trong `content.facade.spec.ts` kiểm tra lấy danh sách bài viết, PII masking, và cơ chế keyset cursor `nextCursor`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bổ sung `ContentFacade.listPosts` khớp yêu cầu trong `discovery/README.md` | Đạt | `apps/core-api/src/modules/content/content.facade.ts` |
| Sắp xếp theo `updatedAt ASC, id ASC` phục vụ job đồng bộ incremental sync | Đạt | `PostRepository.findPostsForSync` |
| Tự động che PII `bookingId` và đính kèm disclaimer | Đạt | `content.facade.spec.ts` test pass |
| Không vi phạm ranh giới module, không dính lỗi lint/typecheck/test | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (220/220 tests pass trên core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful across 13 packages (Pass 100%).
- `pnpm --filter @tripflix/core-api test`: 28 test files pass, 220 tests pass (10/10 tests pass trong `content.facade.spec.ts`).
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `cd tripflix-be`
2. `node tools/check-boundaries.mjs`
3. `pnpm --filter @tripflix/core-api test -- content.facade.spec.ts`
4. `pnpm typecheck`

## Ảnh hưởng tới phần của người khác
- Giúp mở khóa công việc của Duy (`discovery`): Duy có thể inject `ContentFacade` và gọi `listPosts({ updatedAfter, cursor })` để dựng job đồng bộ bài viết cho `/search/posts`.
- Không làm thay đổi hay ảnh hưởng đến code của các thành viên khác.
