# TF24 — Bọc Transaction @Transactional('content') & Tích hợp Transactional Outbox

- Notion: https://notion.so/tripflix/TF24 · Nhánh: `thanh/TF24-transactional-outbox` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Tạo bảng Outbox cho Content (`content.outbox_events`)**:
  - Khởi tạo `apps/core-api/src/modules/content/db/schema/outbox.ts` sử dụng hàm tiện ích `createOutboxTable(contentSchema, 'outbox_events')` từ `@tripflix/outbox`.
  - Export bảng outbox trong `db/schema/index.ts`.
  - Tạo file migration chuẩn Drizzle: `apps/core-api/src/modules/content/db/migrations/20261105100000_add_content_outbox/migration.sql` thiết lập bảng `content.outbox_events` với đầy đủ indexes (`status, attempts`, `created_at`).
- **Nâng cấp Repositories hỗ trợ Dynamic Executor trong Transaction**:
  - Cập nhật cả 5 Repositories của phân hệ Social (`PostRepository`, `CommentRepository`, `ReactionRepository`, `BookmarkRepository`, `ModerationActionRepository`): constructor nhận `dbOrGetDb: Db | (() => Db)`, getter `this.db` tự động trích xuất transaction active `() => txHost.tx` khi chạy trong transaction hoặc kết nối thường khi ở ngoài transaction. Giữ tương thích 100% với các test đơn vị cũ.
- **Tạo Port `ContentOutbox` (Clean Architecture)**:
  - Tạo port `apps/core-api/src/modules/content/social/application/ports/content-outbox.port.ts` để tầng Application không phụ thuộc trực tiếp vào tầng hạ tầng `@tripflix/outbox`.
- **Bọc `@Transactional('content')` và chuyển sang Transactional Outbox**:
  - Gói toàn bộ thao tác ghi DB và ghi event trong cùng một transaction PostgreSQL qua decorator `@Transactional('content')` cho 6 use cases:
    - `PublishPostUseCase` (phát `content.post.published`)
    - `AdminModeratePostUseCase` (phát `content.post.moderated`)
    - `DeletePostUseCase` (phát `content.post.deleted`)
    - `SetReactionUseCase` (phát `content.reaction.updated`)
    - `AddCommentUseCase` (phát `content.comment.created`)
    - `TrackShareUseCase` (phát `content.post.shared`)
  - Chuyển việc ghi nhận event từ gọi Redis XADD phân tán không an toàn sang gọi `ContentOutbox.add()` nguyên tử trong cùng transaction DB. Khi DB rollback, event tự động hủy, chống triệt để tình trạng phantom event.
- **Triển khai `ContentOutboxRelay` đẩy sự kiện sang Redis Streams**:
  - Tạo `apps/core-api/src/modules/content/social/infra/content-outbox-relay.ts` kế thừa `OutboxRelay` của `@tripflix/outbox`.
  - Áp dụng cơ chế phân luồng stream động: `envelope.type.startsWith('media.') ? STREAMS.media : STREAMS.content`, giúp relay tự động định tuyến sự kiện Media sang `stream:media` và Social sang `stream:core.content`.
  - Relay sử dụng `FOR UPDATE SKIP LOCKED` tranh chấp lô an toàn giữa nhiều node và chỉ khởi động khi `APP_ROLE` là `worker` hoặc `all`.
- **Hoàn thiện cấu hình NestJS DI trong `content.module.ts`**:
  - Khai báo token `CONTENT_OUTBOX`, inject `DrizzleOutboxWriter` với `txHost` của schema `content`.
  - Cung cấp dynamic executor `() => txHost.tx` cho tất cả các Repositories.
  - Đăng ký `ContentOutboxRelay`.
- **Kiểm thử và biên dịch**:
  - Viết unit test cho `ContentOutboxRelay` (`content-outbox-relay.spec.ts`).
  - Cập nhật bộ unit test use cases trong `social-use-cases.spec.ts` dùng `createNoOpTransactionalPlugins()` và `mockOutbox`.
  - Toàn bộ 18 test suites của `core-api` (161 tests) và toàn bộ 13 packages trong workspace đều pass 100%.

## Đối chiếu "Xong khi"
| Tiêu chí (chép từ Notion & Audit) | Đạt | Bằng chứng (tên test, lệnh, ảnh, link) |
|---|---|---|
| Bảng `content.outbox_events` được tạo theo chuẩn `@tripflix/outbox` | Đạt | `apps/core-api/src/modules/content/db/schema/outbox.ts` & migration sql |
| Các thao tác thay đổi trạng thái/bình luận/cảm xúc/chia sẻ/kiểm duyệt được bọc trong `@Transactional('content')` | Đạt | 6 Use cases: `publish-post`, `admin-moderate-post`, `delete-post`, `set-reaction`, `add-comment`, `track-share` |
| Event được ghi vào transactional outbox thay vì gọi trực tiếp Redis XADD rời rạc | Đạt | Port `ContentOutbox.add()` được gọi trong transaction của từng use case |
| Có `ContentOutboxRelay` đẩy event sang Redis Streams (hỗ trợ phân tách stream media và content) | Đạt | `content-outbox-relay.ts` & `content-outbox-relay.spec.ts` (2/2 tests pass) |
| Repositories tự động dùng executor từ `TransactionHost` | Đạt | Pattern `constructor(private readonly dbOrGetDb: Db | (() => Db))` |
| Không vi phạm ranh giới module, không dính lỗi lint/typecheck/test | Đạt | `node tools/check-boundaries.mjs` (0 vi phạm), `pnpm lint` (0 errors), `pnpm typecheck` (pass 100%), `pnpm test` (161/161 tests pass trên core-api) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: 22 tasks successful, 0 errors.
- `pnpm typecheck`: 22 tasks successful across 13 packages (Pass 100%).
- `pnpm test`: Toàn bộ 161 tests của `core-api` và các gói liên quan đều pass.
- `pnpm contracts:build`: Đã ghi `contracts/openapi/core-api.json`.

## Cách kiểm lại
1. `cd tripflix-be`
2. `node tools/check-boundaries.mjs`
3. `pnpm --filter @tripflix/core-api test`
4. `pnpm typecheck`

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng: Toàn bộ thay đổi nằm trong phân hệ Content/Social của Thành (`apps/core-api/src/modules/content/`), sử dụng thư viện `@tripflix/outbox` và `@tripflix/db` dùng chung mà không sửa đổi code của các thành viên khác.
