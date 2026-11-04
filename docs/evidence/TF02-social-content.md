# TF02 — Hoàn thiện phân hệ Social & Content API Endpoints

- Notion: https://notion.so/tripflix/TF02-social-content · Nhánh: `thanh/TF02-social-content` · Người làm: Thành (Lê Quang Thành) · Ngày: 2026-11-04

## Đã làm
- Khảo sát và xây dựng tài liệu kiến trúc & đặc tả API phân hệ Social & Content (`ROADMAP_AND_PROPOSALS.md` và `API_ENDPOINTS.md` với đầy đủ 20 API endpoints).
- Xây dựng schema Drizzle ORM và migration cho schema `content`: bảng `posts`, `comments`, `reactions`, `bookmarks`, `moderation_actions`.
- Xây dựng tầng Domain Entity thuần túy (`Post`, `Comment`, `Reaction`) với các quy tắc nghiệp vụ cốt lõi, bảo toàn ranh giới sạch (0 imports NestJS / Drizzle).
- Xây dựng tầng Infrastructure Repository (`PostRepository`, `CommentRepository`, `ReactionRepository`, `BookmarkRepository`, `ModerationActionRepository`) thao tác trực tiếp trên PostgreSQL schema `content`.
- Xây dựng tầng Application gồm 17 Use Cases bao phủ các chức năng: bài đăng (draft, publish, update, delete, get detail, list cursor), cảm xúc & thống kê tương tác thời gian thực, bình luận phân cấp 1 level, lưu bài viết offline, share tracking, kiểm duyệt quản trị Admin, tích hợp Outbox event publisher và Commerce service port.
- Xây dựng tầng API Controller & DTOs với đầy đủ Swagger/OpenAPI decorators (`PostsController`, `ReactionsController`, `CommentsController`, `BookmarksController`, `AdminPostsController`).
- Đăng ký toàn bộ dependency injection trong `ContentModule` và xuất bản `ContentFacade` cho các module `discovery`, `feed` gọi nội bộ an toàn.
- Chạy `pnpm contracts:build` sinh thành công `contracts/openapi/core-api.json` (1,097 dòng) và các event schemas.
- Viết 62 unit tests cho Domain, Use Cases, Controllers và Facade, đạt tỷ lệ pass 100%.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Hoàn thiện 20 API endpoints theo đúng tài liệu FR 1 - FR 13 & PRD F3, F5, F11 | Đạt | Toàn bộ 5 Controller và 17 Use Case trong `apps/core-api/src/modules/content/social/` |
| Tuân thủ Clean Architecture & Clean Boundaries (domain/ không import NestJS/Drizzle) | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm) |
| Bảo mật dữ liệu & PII Masking trên lộ trình đính kèm (`trip_attachment`) | Đạt | Test `Post.getMaskedTripAttachment()` và `ContentFacade.getVisiblePosts()` pass |
| Idempotency & Tương tác thời gian thực (Atomic Counters, Idempotent Reaction toggle) | Đạt | `SetReactionUseCase`, `PostRepository.incrementCounter` test pass |
| Quản trị & kiểm duyệt nội dung (Admin Moderation $\le 3$s Outbox event) | Đạt | `AdminModeratePostUseCase`, `AdminPostsController` test pass |
| Biên dịch thành công OpenAPI 3.0 Contract | Đạt | `pnpm contracts:build` -> `contracts/openapi/core-api.json` |
| 100% Typecheck, Linter và Unit Test pass | Đạt | `pnpm check` (62/62 tests pass, 0 lint warnings/errors, typecheck exit 0) |

## Kết quả kiểm tra
- `pnpm lint`: 0 warnings, 0 errors trên toàn bộ 8 packages.
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm typecheck`: Thành công trên toàn bộ workspace monorepo.
- `pnpm test`: 62/62 tests passed:
  - `post.entity.spec.ts`: 18 tests
  - `social-use-cases.spec.ts`: 13 tests
  - `social.controllers.spec.ts`: 21 tests
  - `content.facade.spec.ts`: 8 tests
  - `health.controller.spec.ts`: 2 tests

## Cách kiểm lại
1. Di chuyển vào thư mục backend: `cd tripflix-be`
2. Kiểm tra toàn bộ mã nguồn: `pnpm check`
3. Kiểm tra biên dịch hợp đồng OpenAPI: `pnpm contracts:build`

## Ảnh / video
- Đợt cập nhật Backend Core API & Contracts: Không thay đổi giao diện frontend.

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng tới code của người khác: Mọi thay đổi nằm độc lập trong `apps/core-api/src/modules/content/`, `docs/`, `contracts/`.
