# Social & Content — Kế hoạch Triển khai & Đề xuất Kỹ thuật (Roadmap & Proposals)

> **Người phụ trách:** Lê Quang Thành (Module Social & Content)  
> **Dự án:** Tripflix OTA Monorepo · `tripflix-be` (Core API)  
> **Tài liệu tham chiếu:** [05-prd-tripflix-v3.md](../../../../05-prd-tripflix-v3.md) · [RULES.md](../../RULES.md) · [API_ENDPOINTS.md](./API_ENDPOINTS.md)

---

## 1. Bối cảnh & Phạm vi công việc

Theo [07-phan-cong-nghien-cuu-module.md](../../../../07-phan-cong-nghien-cuu-module.md) và [RULES.md](../../RULES.md) §10, Lê Quang Thành phụ trách:
- **Backend (`tripflix-be`)**:
  - Chủ sở hữu module con: `apps/core-api/src/modules/content/social/` (Đăng bài, bản nháp, bình luận, cảm xúc, lưu bài, chia sẻ link).
  - Đồng sở hữu database schema: `content/db/schema/` (cùng Phong và Trang).
- **Frontend (`tripflix-fe`)**:
  - Phụ trách `apps/web`, `apps/admin`, `packages/ui-web`.
- **Mục tiêu chính**: Hiện thực hóa các nhiệm vụ theo Notion:
  - `TF07` · Tạo bộ bài đăng mô phỏng
  - `TF24` · Đăng bài video hoặc vlog kèm lộ trình
  - `TF25` · Tương tác bài đăng trên app và web
  - `TF38` · Dấu "Đã xác thực" và quyền riêng tư của lộ trình
  - `TF45` · Chia sẻ lên mạng xã hội và deep link
  Bao gồm toàn bộ **13 Functional Requirements (FR)** và **20 API Endpoints** đã chuẩn hóa, đồng thời vượt qua các bài kiểm thử tự động (Unit test, Typecheck, Lint, Boundary check) trước khi merge vào nhánh `develop`.

---

## 2. Tổng hợp các Đề xuất Kỹ thuật (Technical Proposals)

### Đề xuất 1: Thiết kế Cơ sở dữ liệu (Drizzle Schema) trong schema `content`
- **Nguyên tắc:** Dùng chung schema `content` với user Postgres `tf_content` (theo kiến trúc monorepo đã duyệt tại `docs/architecture/11 §3.3`).
- **Các bảng do Social trực tiếp quản lý:**
  1. `posts`: Lưu bài viết (video dọc hoặc vlog), trạng thái (`draft`, `published`, `hidden`, `removed`, `deleted`), quyền riêng tư (`public`, `private`), dấu `is_verified`, dữ liệu lộ trình JSONB (`trip_attachment`), và các trường đếm tổng hợp (`reaction_counts`, `comment_count`, `share_count`, `bookmark_count`).
  2. `comments`: Lưu bình luận và cây phân cấp 1-level reply (`parent_comment_id`), hỗ trợ chỉnh sửa và xóa mềm.
  3. `reactions`: Bảng quan hệ N-N giữa `users` và `posts` với composite unique key `(user_id, post_id)` để đảm bảo tính Idempotent.
  4. `bookmarks`: Bảng lưu bài viết của người dùng với unique key `(user_id, post_id)`.

### Đề xuất 2: Quy trình tự động gắn nhãn "ĐÃ XÁC THỰC" (Verified Badge - F2/FR3)
- **Vấn đề:** Tránh trường hợp người dùng tự ý gắn cờ "Đã xác thực" hoặc thông tin chuyến đi không có thật.
- **Giải pháp:**
  - Khi người dùng xuất bản bài viết (`POST /v1/posts/{post_id}/publish`):
    - Nếu bài viết có đính kèm `booking_id`: Tầng Application gọi method `commerce.verifyCompletedBooking(bookingId, authorId)` (thông qua interface được export từ `modules/commerce/index.ts`).
    - Nếu đơn đặt chỗ tại khách sạn/vé máy bay đã hoàn tất thanh toán và đã qua ngày sử dụng: Hệ thống tự động gán `is_verified = true`.
    - Ngược lại: Gán `is_verified = false`. Người dùng tuyệt đối không thể tự truyền cờ này qua request body.

### Đề xuất 3: Bảo mật thông tin riêng tư (PII Masking) cho lộ trình đính kèm (PRD F5)
- **Vấn đề:** Khi một người dùng chia sẻ chuyến đi đã đặt qua Tripflix, không được làm lộ mã đặt chỗ nhạy cảm, số tiền thực trả sau khuyến mãi, họ tên thật hoặc số điện thoại.
- **Giải pháp:**
  - Tầng Domain/Application thực hiện che giấu dữ liệu (Masking) trước khi lưu hoặc khi trả về API công khai:
    - Loại bỏ mã PNR, booking code cá nhân.
    - Chuyển đổi chi phí thực tế thành trường `estimated_cost` (Giá ước tính/người).
    - Tự động đính kèm thông điệp cảnh báo bắt buộc: `"Giá chỉ mang tính chất tham khảo"`.

### Đề xuất 4: Xử lý mạng chập chờn & Thao tác ngoại tuyến (Network Resilience - FR8, FR9, FR10, FR11)
- **Vấn đề:** Ứng dụng di động hoạt động trong điều kiện 4G yếu hoặc rớt mạng khi đang viết bài, bình luận hoặc thả tim.
- **Giải pháp:**
  - **Idempotency Key:** Các API ghi (`POST /posts`, `POST /comments`, `PUT /reaction`) chấp nhận header `Idempotency-Key` (UUID). Nếu client gửi lại cùng key, backend trả về kết quả đã xử lý trước đó mà không tạo thêm bản ghi mới.
  - **Atomic SQL Upsert:**
    - Cảm xúc (`reactions`): Dùng `INSERT ... ON CONFLICT (user_id, post_id) DO UPDATE`.
    - Bộ đếm tương tác (`stats`): Cập nhật trực tiếp bằng phép cộng/trừ trong SQL (`reaction_counts = jsonb_set(...)`, `comment_count = comment_count + 1`), không đọc ra RAM rồi ghi lại để tránh Race Condition khi có hàng nghìn tương tác đồng thời.

### Đề xuất 5: Đồng bộ dữ liệu & Kiểm duyệt thời gian thực $\le 3$ giây (PRD F8/FR13)
- **Vấn đề:** Khi Moderator thực hiện ẩn bài vi phạm (`action: "hide"`), bài viết phải lập tức biến mất khỏi Mobile App, Web, kết quả tìm kiếm của Discovery và bảng tin của Feed.
- **Giải pháp:**
  - Sử dụng **Outbox Pattern**: Trong cùng một transaction cập nhật `posts.status = 'hidden'` và ghi `moderation_actions`, ghi thêm 1 bản ghi sự kiện `content.post.moderated` vào bảng `outbox`.
  - Outbox relay đẩy sự kiện sang Redis Streams (`@tripflix/event-bus`).
  - Consumer của Discovery và Feed lắng nghe sự kiện này để gỡ bài khỏi index và cache trong vòng $\le 3$ giây.

### Đề xuất 6: Phân trang Keyset (Cursor-based Pagination)
- **Vấn đề:** Phân trang dạng Offset (`page`, `offset`) trên bảng tin mạng xã hội dễ bị trùng lặp bài hoặc nhảy cóc khi có bài viết mới liên tục xuất hiện ở đầu bảng.
- **Giải pháp:** Sử dụng phân trang theo `cursor` mã hóa `(created_at, id)`. Truy vấn SQL: `WHERE (created_at, id) < (cursor_created_at, cursor_id) ORDER BY created_at DESC, id DESC LIMIT :limit`.

---

## 3. Bản đồ File & Thư mục sẽ thao tác trong `tripflix-be`

```
apps/core-api/src/modules/content/
├── db/
│   ├── schema/
│   │   ├── posts.ts            # Schema bảng posts & type definitions
│   │   ├── comments.ts         # Schema bảng comments & foreign keys
│   │   ├── reactions.ts        # Schema bảng reactions & unique index
│   │   ├── bookmarks.ts        # Schema bảng bookmarks & unique index
│   │   └── index.ts            # Export toàn bộ schema của content
│   └── migrations/             # Thư mục chứa file migration sinh bởi drizzle-kit
│
├── social/
│   ├── domain/                 # Domain model thuần (Zero dependencies ngoại trừ TypeScript)
│   │   ├── post.entity.ts      # Entity Post, Value Objects, Status Enum
│   │   ├── comment.entity.ts   # Entity Comment
│   │   ├── reaction.entity.ts  # Entity Reaction, Type Enum
│   │   └── errors.ts           # Domain Exceptions
│   │
│   ├── application/            # Use cases & Business Logic
│   │   ├── use-cases/
│   │   │   ├── create-draft.use-case.ts
│   │   │   ├── update-post.use-case.ts
│   │   │   ├── publish-post.use-case.ts
│   │   │   ├── delete-post.use-case.ts
│   │   │   ├── get-post-detail.use-case.ts
│   │   │   ├── list-posts.use-case.ts
│   │   │   ├── list-my-posts.use-case.ts
│   │   │   ├── set-reaction.use-case.ts
│   │   │   ├── get-post-stats.use-case.ts
│   │   │   ├── add-comment.use-case.ts
│   │   │   ├── edit-comment.use-case.ts
│   │   │   ├── delete-comment.use-case.ts
│   │   │   ├── list-comments.use-case.ts
│   │   │   ├── bookmark-post.use-case.ts
│   │   │   ├── list-bookmarks.use-case.ts
│   │   │   ├── track-share.use-case.ts
│   │   │   └── admin-moderate-post.use-case.ts
│   │   └── outbox/
│   │       └── social-events.ts # Định nghĩa payload sự kiện outbox
│   │
│   ├── infra/                  # Drizzle Repositories
│   │   ├── post.repository.ts
│   │   ├── comment.repository.ts
│   │   ├── reaction.repository.ts
│   │   └── bookmark.repository.ts
│   │
│   └── api/                    # NestJS Controllers, DTOs & Validation
│       ├── posts.controller.ts
│       ├── comments.controller.ts
│       ├── reactions.controller.ts
│       ├── bookmarks.controller.ts
│       ├── admin-posts.controller.ts
│       └── dto/
│           ├── create-post.dto.ts
│           ├── update-post.dto.ts
│           ├── set-reaction.dto.ts
│           ├── comment.dto.ts
│           └── moderation.dto.ts
│
├── content.module.ts           # Đăng ký Controller, Use Case, Repository vào ContentModule
├── content.facade.ts           # Public Facade cho các module khác (discovery, feed) gọi nội bộ
└── index.ts                    # Export duy nhất của module content
```

---

## 4. Kế hoạch Triển khai (Implementation Tracking Roadmap)

Dưới đây là checklist theo từng pha (Phase), có thể dùng trực tiếp để tracking tiến độ thực hiện:

### [x] Phase 1: Database Schema & Migration Setup
- [x] Thiết kế `db/schema/posts.ts` (id, author_id, post_type, title, body, hashtags, status, visibility, is_verified, trip_attachment jsonb, reaction_counts jsonb, comment_count, share_count, bookmark_count, timestamps, soft-delete).
- [x] Thiết kế `db/schema/comments.ts` (id, post_id, author_id, parent_comment_id, body, is_edited, timestamps, soft-delete).
- [x] Thiết kế `db/schema/reactions.ts` (id, post_id, user_id, type, timestamps; Unique composite index trên `post_id + user_id`).
- [x] Thiết kế `db/schema/bookmarks.ts` (id, post_id, user_id, timestamps; Unique composite index trên `post_id + user_id`).
- [x] Cập nhật `db/schema/index.ts` để export toàn bộ schema mới.
- [x] Chạy lệnh `pnpm db:generate content` để sinh migration SQL trong `src/modules/content/db/migrations/`.

### [x] Phase 2: Domain Layer (Core Business Rules)
- [x] Tạo `social/domain/errors.ts`: Định nghĩa các lỗi nghiệp vụ (`PostNotFoundException`, `UnauthorizedPostActionException`, `InvalidPostStatusTransitionException`, `InvalidCommentException`).
- [x] Tạo `social/domain/post.entity.ts`: Entity thuần túy mô hình hóa trạng thái bài viết, quy tắc chuyển đổi (`draft` -> `published`, soft delete), logic kiểm tra tính hợp lệ của media.
- [x] Tạo `social/domain/comment.entity.ts`: Entity thuần túy quản lý bình luận.
- [x] Tạo `social/domain/reaction.entity.ts`: Entity quản lý loại cảm xúc (`like`, `love`, `helpful`).
- [x] Viết unit test cho các quy tắc Domain Entity.

### [x] Phase 3: Infrastructure Layer (Drizzle Repositories)
- [x] Tạo `social/infra/post.repository.ts`: Triển khai các câu lệnh truy vấn Drizzle ORM (tạo nháp, update, publish, soft-delete, lấy chi tiết kèm author join, lọc feed theo cursor).
- [x] Tạo `social/infra/reaction.repository.ts`: Triển khai atomic upsert reaction và cập nhật atomic counter trên post.
- [x] Tạo `social/infra/comment.repository.ts`: Triển khai thêm bình luận, cập nhật, xóa mềm và atomic counter.
- [x] Tạo `social/infra/bookmark.repository.ts`: Triển khai lưu / bỏ lưu bài viết.

### [x] Phase 4: Application Layer (Use Cases & Outbox)
- [x] Xây dựng nhóm Use Case bài đăng:
  - `CreateDraftUseCase`
  - `UpdatePostUseCase`
  - `PublishPostUseCase` (tích hợp logic kiểm tra đơn hoàn tất từ `commerce` để cấp nhãn `is_verified`)
  - `DeletePostUseCase`
  - `GetPostDetailUseCase` (kèm PII Masking cho `trip_attachment`)
  - `ListPostsUseCase` (Feed/Search cursor)
  - `ListMyPostsUseCase` (`ListUserPostsUseCase`)
- [x] Xây dựng nhóm Use Case cảm xúc & tương tác:
  - `SetReactionUseCase` (Idempotent toggle/change/remove)
  - `GetPostStatsUseCase`
- [x] Xây dựng nhóm Use Case bình luận:
  - `AddCommentUseCase` (chống trùng với Idempotency-Key)
  - `EditCommentUseCase`
  - `DeleteCommentUseCase`
  - `ListCommentsUseCase`
- [x] Xây dựng nhóm Use Case bookmark & share:
  - `BookmarkPostUseCase` & `ListBookmarksUseCase`
  - `TrackShareUseCase`
- [x] Xây dựng nhóm Use Case quản trị:
  - `AdminModeratePostUseCase` (Ghi nhận `moderation_actions` và outbox `content.post.moderated`)
- [x] Đảm bảo toàn bộ Use Case phát sự kiện outbox đúng quy chuẩn (`content.post.published`, `content.post.deleted`, `content.reaction.updated`, `content.comment.created`, `content.post.shared`, `content.post.moderated`).

### [x] Phase 5: API Layer (Controllers, DTOs & OpenAPI Documentation)
- [x] Xây dựng DTOs với validation nghiêm ngặt và Decorators của `@nestjs/swagger` (`@ApiProperty`, `@ApiResponse`):
  - `CreatePostDto`, `UpdatePostDto`, `ListPostsQueryDto`, `ListUserPostsQueryDto`
  - `SetReactionDto`
  - `CreateCommentDto`, `UpdateCommentDto`, `ListCommentsQueryDto`
  - `SetBookmarkDto`, `ListBookmarksQueryDto`
  - `CreateModerationActionDto`, `AdminPostQueryDto`
- [x] Tạo `social/api/posts.controller.ts` (các endpoint `/v1/posts`, `/v1/posts/:id`, `/v1/posts/:id/publish`, `/v1/me/posts`, `/v1/posts/:id/shares`).
- [x] Tạo `social/api/reactions.controller.ts` (các endpoint `/v1/posts/:id/reaction`, `/v1/posts/:id/stats`).
- [x] Tạo `social/api/comments.controller.ts` (các endpoint `/v1/posts/:postId/comments`, `/v1/comments/:commentId`).
- [x] Tạo `social/api/bookmarks.controller.ts` (các endpoint `/v1/posts/:id/bookmark`, `/v1/me/bookmarks`).
- [x] Tạo `social/api/admin-posts.controller.ts` (các endpoint `/v1/admin/posts`, `/v1/admin/posts/:id`, `/v1/admin/posts/:id/moderation-actions`).
- [x] Đăng ký tất cả controllers và use cases vào `content.module.ts`.
- [x] Viết unit tests kiểm thử toàn diện các controllers trong `social.controllers.spec.ts` (21 tests pass).

### [x] Phase 6: Public Facade & Hợp đồng Inter-Module
- [x] Tạo `content.facade.ts` trong `modules/content/` cung cấp method `getVisiblePosts(postIds: string[])` (kèm PII Masking) cho module `discovery` và `feed` sử dụng trực tiếp trong tiến trình.
- [x] Cung cấp method `getPostById(id)`, `isPostPublished(id)` và `getPostStats(postId)`.
- [x] Export `ContentModule`, `ContentFacade`, `VisiblePostSummary`, `PostStatsSummary` tại `modules/content/index.ts`.
- [x] Viết unit tests kiểm thử toàn diện `ContentFacade` trong `content.facade.spec.ts` (8 tests pass).

### [x] Phase 7: Kiểm thử toàn diện & Biên dịch Contracts (Testing & Verification)
- [x] Chạy bộ Unit Tests với Vitest: `pnpm test` (62/62 tests pass 100%).
- [x] Chạy công cụ kiểm tra ranh giới: `node tools/check-boundaries.mjs` (0 vi phạm).
- [x] Chạy Typecheck: `pnpm typecheck` (100% sạch lỗi).
- [x] Chạy Linter: `pnpm lint` (0 warnings, 0 errors).
- [x] Chạy lệnh `pnpm contracts:build` biên dịch và cập nhật file `contracts/openapi/core-api.json`.
- [x] Lập các file Evidence theo mẫu `RULES.md §7` tại `docs/evidence/` cho các mã task Notion:
  - `TF07 · Tạo bộ bài đăng mô phỏng` (`docs/evidence/TF07-tao-bo-bai-dang-mo-phong.md`)
  - `TF24 · Đăng bài video hoặc vlog kèm lộ trình` (`docs/evidence/TF24-dang-bai-video-vlog-kem-lo-trinh.md`)
  - `TF25 · Tương tác bài đăng trên app và web` (`docs/evidence/TF25-tuong-tac-bai-dang-app-web.md`)
  - `TF38 · Dấu "Đã xác thực" và quyền riêng tư của lộ trình` (`docs/evidence/TF38-dau-da-xac-thuc-quyen-rieng-tu-lo-trinh.md`)
  - `TF45 · Chia sẻ lên mạng xã hội và deep link` (`docs/evidence/TF45-chia-se-mang-xa-hoi-deep-link.md`)

---

## 5. Điểm phối hợp với các thành viên khác

| Thành viên | Module | Nội dung cần thống nhất |
|---|---|---|
| **Nguyễn Lê Phúc Thắng** | `commerce` | Thống nhất interface kiểm tra đơn đặt chỗ đã hoàn tất (`verifyCompletedBooking`) để cấp dấu "Đã xác thực" cho bài đăng. Thống nhất cấu trúc dữ liệu lộ trình chuyển đổi sang giỏ hàng ("Đặt y chang" - F5). |
| **Lê Thị Thùy Trang** | `moderation` | Thống nhất bảng `moderation_actions` và luồng đồng bộ ẩn/gỡ bài viết $\le 3$s khi bị báo cáo hoặc vi phạm quy chuẩn. |
| **Nguyễn Thanh Phong** | `content/media` & `feed` | Thống nhất trạng thái media (`media_assets`) trước khi cho phép xuất bản bài viết (`publish`). Cung cấp tín hiệu tương tác (`content.post.published`, `content.reaction.updated`) cho thuật toán tính điểm xu hướng của Feed. |
| **Hoàng Đức Dũng** | `access` & `libs` | Thống nhất cơ chế giải mã JWT Authentication, kiểm tra role `@Roles('moderator', 'superadmin')` và interceptor `Idempotency-Key`. |
| **Lê Anh Duy** | `discovery` | Cung cấp Facade `content.getVisiblePosts(ids)` để module tìm kiếm lấy thông tin hiển thị thẻ bài viết. |
