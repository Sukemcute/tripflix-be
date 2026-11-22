# TF24 — Đăng bài video hoặc vlog kèm lộ trình

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF02-social-content` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-04

## Đã làm
- Hiện thực toàn bộ vòng đời bài đăng video/vlog: tạo bản nháp (`POST /v1/posts`), cập nhật nội dung (`PATCH /v1/posts/:id`), xuất bản (`POST /v1/posts/:id/publish`), xóa mềm (`DELETE /v1/posts/:id`), xem chi tiết (`GET /v1/posts/:id`), lấy danh sách bài viết theo Keyset Cursor (`GET /v1/posts`), và danh sách bài đăng cá nhân (`GET /v1/me/posts`).
- Hỗ trợ đính kèm lộ trình du lịch (`trip_attachment`) dạng JSONB trong bảng `content.posts`.
- Tích hợp Outbox event publisher để xuất bản sự kiện `content.post.published` và `content.post.deleted` sang Redis Streams khi trạng thái thay đổi.
- Đảm bảo kiểm soát quyền sở hữu: chỉ tác giả mới có quyền sửa, xóa hoặc xuất bản bài viết của mình.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Cho phép tạo bản nháp video hoặc vlog kèm tiêu đề, nội dung, hashtag, media_ids, trip_attachment | Đạt | `CreateDraftUseCase`, test trong `social-use-cases.spec.ts` và `social.controllers.spec.ts` |
| Hỗ trợ chỉnh sửa và xuất bản bài viết chuyển trạng thái từ draft sang published | Đạt | `PublishPostUseCase`, test "chuyển trạng thái sang published khi dữ liệu hợp lệ" pass |
| Hỗ trợ xóa mềm bài đăng kèm phát sự kiện `content.post.deleted` | Đạt | `DeletePostUseCase`, test "xóa mềm và publish event" pass |
| Lấy danh sách bài viết phân trang Keyset Cursor base64url | Đạt | `ListPostsUseCase`, `social.controllers.spec.ts` test "GET /posts trả về items và nextCursor" pass |
| Xem chi tiết bài đăng và danh sách bài của tôi | Đạt | `GetPostDetailUseCase`, `ListUserPostsUseCase`, tests pass |
| 100% Lint, Typecheck, Unit Test pass | Đạt | `pnpm check` (62/62 tests pass) |

## Kết quả kiểm tra
- `pnpm lint`: 0 warnings, 0 errors.
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm typecheck`: Thành công trên toàn bộ workspace monorepo.
- `pnpm test`: 62/62 tests pass (trong đó 18 tests domain Post entity, 13 tests use cases, 21 tests controllers, 8 tests facade, 2 health tests).

## Cách kiểm lại
1. `cd tripflix-be`
2. `pnpm check`
3. `pnpm contracts:build`

## Ảnh / video
- Đợt cập nhật Backend Core API & Contracts: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không: Toàn bộ nằm trong phân hệ `apps/core-api/src/modules/content/social/`, tương thích với `MediaModule` và `AccessModule`.
