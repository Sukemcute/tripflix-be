# TF25 — Bổ sung viewerContext vào danh sách bài viết

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-viewer-context-danh-sach-bai-viet` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-11

## Đã làm
- Bổ sung `viewerContext` (`myReaction`, `isBookmarked`) vào DTO `SocialPostDto` của endpoint `GET /api/v1/posts`.
- Thêm `@OptionalAuthenticated()` và `@OptionalCurrentUser()` tại `PostsController.listPublicPosts` để trích xuất `viewerId` từ session nếu người dùng đã đăng nhập (vẫn hỗ trợ khách vãng lai khi chưa đăng nhập).
- Tối ưu hóa truy vấn batch trong `ListPostsUseCase`: sử dụng `ReactionRepository.findByPostsAndUser` và `BookmarkRepository.findBookmarkedPostIds` chạy song song (`Promise.all`) với toán tử SQL `inArray(postIds)` thay vì N+1 queries.
- Cập nhật hợp đồng OpenAPI `contracts/openapi/core-api.json`.
- Bổ sung kiểm thử đơn vị trong `social-use-cases.spec.ts` và `social.controllers.spec.ts`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| `GET /api/v1/posts` trả về `viewerContext` khi người dùng đăng nhập | Đạt | `ListPostsUseCase.execute({ viewerId })` gán `myReaction` và `isBookmarked` chính xác |
| Khách vãng lai (chưa đăng nhập) nhận `viewerContext: null` | Đạt | `viewerId: null` không gọi query DB thừa |
| Không gây lỗi N+1 truy vấn DB | Đạt | `ReactionRepository.findByPostsAndUser` và `BookmarkRepository.findBookmarkedPostIds` query 1 lần duy nhất với `inArray` |
| Hợp đồng OpenAPI được cập nhật đồng bộ | Đạt | `pnpm contracts:build` -> `contracts/openapi/core-api.json` đã sinh trường `viewerContext` |
| Tuân thủ kiến trúc và ranh giới module BE | Đạt | `node tools/check-boundaries.mjs` báo: "Ranh giới module: không có vi phạm." |
| Kiểm thử đơn vị pass 100% | Đạt | `pnpm vitest run src/modules/content/social` (9/9 suites pass, 131/131 tests pass) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Đạt 0 lỗi.
- `pnpm --filter @tripflix/core-api typecheck`: Đạt 0 lỗi.
- `pnpm lint`: Đạt 0 lỗi.
- `pnpm vitest run src/modules/content/social`: 9 files pass, 131 tests pass.

## Cách kiểm lại
1. Chạy `pnpm vitest run src/modules/content/social`.
2. Kiểm tra schema trong `contracts/openapi/core-api.json`.

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng module khác. Chỉ bổ sung trường tùy chọn `viewerContext` vào `SocialPostDto` tương thích ngược hoàn toàn.
