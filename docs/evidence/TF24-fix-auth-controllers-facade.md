# TF24 — Đồng bộ Auth chuẩn @tripflix/auth, Rút Repository khỏi Controller & Siết ContentFacade

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-fix-auth-controllers-facade` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Đồng bộ chuẩn `@tripflix/auth` trong toàn bộ Social Controller Layer**:
  - Xóa bỏ hoàn toàn custom decorator `decorators/current-user.decorator.ts` tự trích xuất header `x-user-id` (loại bỏ nguy cơ giả mạo identity).
  - Sử dụng trực tiếp các decorator và type chuẩn từ thư viện chia sẻ `@tripflix/auth`: `@Authenticated()`, `@CurrentUser() user: AuthUser`, `@Roles('moderator', 'superadmin')`.
  - Thay thế thuộc tính định danh từ `user.id` sang `user.userId` khớp với `AuthUser`.
  - Tạo `OptionalAuthGuard` và `@OptionalCurrentUser()` tại `optional-auth.guard.ts` để phục vụ các route công khai có cá nhân hóa (`GET /v1/posts/:id` lấy `viewerContext`, `POST /v1/posts/:id/shares` lưu `userId` khi có đăng nhập) với khả năng xác thực token bằng `AUTH_VERIFIER` và kiểm tra thu hồi `SID_BLOCKLIST`.
- **Rút 100% Repositories ra khỏi Controller Layer (Tuân thủ Clean Architecture)**:
  - Viết 3 Use Cases mới trong `social/application/use-cases/`:
    - `GetMyReactionUseCase`: Lấy cảm xúc của user hiện tại trên bài đăng qua `ReactionRepository`.
    - `ListAdminPostsUseCase`: Quản lý truy vấn danh sách bài viết kiểm duyệt kèm phân trang cursor và đếm tổng số bài viết.
    - `GetAdminPostDetailUseCase`: Lấy chi tiết bài đăng kiểm duyệt kèm toàn bộ lịch sử thao tác từ `ModerationActionRepository`.
  - Khai báo và cấu hình DI cho 3 use cases này trong `content.module.ts`.
  - Loại bỏ hoàn toàn việc inject `ReactionRepository`, `PostRepository`, `ModerationActionRepository` trong `ReactionsController` và `AdminPostsController`.
- **Siết chặt `ContentFacade.getPostById`**:
  - Chỉ trả về dữ liệu khi bài viết ở trạng thái `published` và chưa bị xóa mềm (`!deletedAt`), trả về `null` trong mọi trường hợp nháp, ẩn hoặc đã xóa.
  - Tự động thực hiện PII Masking loại bỏ `bookingId` riêng tư và đính kèm `priceDisclaimer` theo quy chuẩn PRD F5.
- **Giới hạn trần phân trang**:
  - Chuẩn hóa giới hạn `limit` trong các Use Cases: phân trang bảng tin/bình luận/bookmark từ 1 đến tối đa 50 phần tử, phân trang quản trị từ 1 đến tối đa 100 phần tử để bảo vệ tài nguyên hệ thống.
- **Kiểm thử và cập nhật hợp đồng API**:
  - Bổ sung các unit test mới cho 3 Use Cases và cập nhật toàn bộ test của các Controller trong `social.controllers.spec.ts`.
  - Cập nhật test `ContentFacade` trong `content.facade.spec.ts`.
  - Tổng số test của `core-api` đạt **139 tests pass 100%**.
  - Đồng bộ hợp đồng OpenAPI: `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Sử dụng đồng bộ `@tripflix/auth` (`@Authenticated`, `@CurrentUser`, `@Roles`), xóa custom decorator `x-user-id` | Đạt | `apps/core-api/src/modules/content/social/api/*.controller.ts` & `optional-auth.guard.ts` |
| Rút toàn bộ Repository khỏi Controllers, tuân thủ Clean Architecture qua Use Cases | Đạt | `GetMyReactionUseCase`, `ListAdminPostsUseCase`, `GetAdminPostDetailUseCase` |
| Siết `ContentFacade.getPostById` chỉ trả bài `published` và ẩn PII `bookingId` | Đạt | `content.facade.spec.ts` ("trả về bài viết an toàn đã mask PII khi tồn tại và published") pass |
| Chặn trần phân trang trong Use Cases (tối đa 50 với user, 100 với admin) | Đạt | Đã kiểm chứng trong tất cả các use cases list |
| Không vi phạm ranh giới module, không dính lỗi lint/typecheck/test | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm check` (139/139 tests pass trên core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm --filter @tripflix/core-api lint`: 0 errors.
- `pnpm typecheck`: 22 tasks successful across 13 packages (Pass 100%).
- `pnpm test`: 139/139 tests pass (14 test files pass 100%).
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `cd tripflix-be`
2. `node tools/check-boundaries.mjs`
3. `pnpm --filter @tripflix/core-api test`
4. `pnpm typecheck`

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng: Toàn bộ thay đổi nằm trong phân hệ Content/Social của Thành (`apps/core-api/src/modules/content/`), sử dụng thư viện `@tripflix/auth` dùng chung mà không sửa đổi `libs/auth`.
