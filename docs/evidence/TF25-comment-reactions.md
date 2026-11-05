# TF25 — Thả tim bình luận và hiển thị trạng thái tương tác bình luận

- Notion: https://notion.so/tripflix/TF25 · Nhánh: `thanh/TF25-comment-reactions` · Người làm: Thành (Lê Quang Thành, dùng AI: có) · Ngày: 2026-11-05

## Đã làm
- **Thiết kế Cơ sở dữ liệu (Drizzle Schema) & Migration cho Thả tim bình luận**:
  - Tạo mới schema bảng `content.comment_reactions` ([comment-reactions.ts](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/apps/core-api/src/modules/content/db/schema/comment-reactions.ts)):
    - `id` (UUID, Primary Key, default random).
    - `comment_id` (UUID, Foreign Key `fk_comment_reactions_comment_id` trỏ vào `content.comments(id)` ON DELETE CASCADE).
    - `user_id` (UUID, NOT NULL).
    - `type` (varchar(20), NOT NULL, default `'like'`).
    - `created_at`, `updated_at` (timestamp with time zone).
    - Composite unique index `idx_comment_reactions_comment_user` trên `(comment_id, user_id)` đảm bảo tính Idempotent tuyệt đối: mỗi người dùng chỉ có tối đa 1 cảm xúc trên 1 bình luận.
    - Index `idx_comment_reactions_user_created` trên `(user_id, created_at)` phục vụ truy vấn lịch sử hoạt động.
  - Bổ sung cột `like_count INTEGER NOT NULL DEFAULT 0` vào bảng `content.comments` ([comments.ts](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/apps/core-api/src/modules/content/db/schema/comments.ts)).
  - Sinh migration tự động nối tiếp `20261105100003_minor_solo` theo đúng quy chuẩn RULES §3 dòng 51:
    - Không sửa đổi hay ảnh hưởng đến bất kỳ migration nào đã merge trên `develop`.
    - Tên foreign key constraint tuân thủ chuẩn `fk_comment_reactions_comment_id` (RULES §4.1).
  - Áp dụng migration thành công vào cơ sở dữ liệu (`pnpm db:migrate`).
- **Domain & Infrastructure Layer**:
  - `Comment` entity: Bổ sung trường `likeCount` vào `CommentProps` và getter `likeCount`.
  - `CommentRepository`: Bổ sung phương thức `incrementLikeCount(id, delta)` sử dụng atomic SQL `GREATEST(like_count + delta, 0)` chống race condition và không bao giờ âm.
  - `CommentReactionRepository` ([comment-reaction.repository.ts](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/apps/core-api/src/modules/content/social/infra/comment-reaction.repository.ts)):
    - `upsert`: Idempotent upsert cảm xúc với `ON CONFLICT (comment_id, user_id) DO UPDATE`.
    - `delete`: Hủy cảm xúc của người dùng trên bình luận.
    - `findByCommentAndUser`: Lấy cảm xúc của user đối với bình luận cụ thể.
    - `findLikedCommentIdsByUser`: Batch check danh sách ID các bình luận mà user đã thả tim trong một truy vấn `WHERE user_id = ... AND comment_id IN (...)` phục vụ hiển thị danh sách bình luận (loại bỏ bài toán $1 + N$ queries).
    - `countByCommentId`: Đếm tổng số lượt tim.
- **Application Layer (Use Cases)**:
  - `SetCommentReactionUseCase` ([set-comment-reaction.use-case.ts](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/apps/core-api/src/modules/content/social/application/use-cases/set-comment-reaction.use-case.ts)):
    - Được bọc trong `@Transactional('content')`.
    - Kiểm tra bình luận tồn tại và chưa bị xóa mềm; nếu không thấy ném `CommentNotFoundException` (được `SocialErrorFilter` xử lý trả 404 Not Found).
    - Hỗ trợ linh hoạt cả 2 chế độ:
      - Chế độ Toggle (khi không truyền `type` hoặc `{}`): Nếu chưa thích -> thích (`isLiked: true`, `likeCount + 1`); nếu đã thích -> hủy thích (`isLiked: false`, `likeCount - 1`).
      - Chế độ Explicit: `type === 'like'` (đảm bảo thích, idempotent không tăng thừa nếu gọi lại) hoặc `type === null` (hủy thích).
    - Phát sự kiện Outbox `content.comment_reaction.updated` trong cùng transaction DB với đầy đủ thông tin `{ commentId, postId, commentAuthorId, userId, isLiked, likeCount }`.
  - `ListCommentsUseCase`:
    - Nhận thêm tham số tùy chọn `viewerId?: string`.
    - Khi có `viewerId`: Thực hiện batch query qua `findLikedCommentIdsByUser` và gán cờ `isLiked: true/false` tương ứng cho từng bình luận.
    - Khi không có `viewerId` (khách vãng lai): Gán `isLiked: false`.
    - Mỗi bình luận trả về luôn có `likeCount: number` và `isLiked: boolean`.
- **API Layer & OpenAPI Documentation**:
  - `PUT /api/v1/comments/:commentId/reaction` ([comments.controller.ts](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/apps/core-api/src/modules/content/social/api/comments.controller.ts)):
    - Yêu cầu xác thực `@ApiBearerAuth()`, `@Authenticated()`.
    - Nhận `SetCommentReactionDto` (`type?: 'like' | null`).
    - Trả về `UpdatedCommentReactionDto` (`{ commentId, isLiked, likeCount }`).
  - `GET /api/v1/posts/:postId/comments`:
    - Áp dụng `@OptionalAuthenticated()` và `@OptionalCurrentUser()`.
    - Khách chưa đăng nhập: Xem được bình luận kèm `likeCount` (với `isLiked = false`).
    - Người dùng đã đăng nhập (gửi Bearer token): Tự động nhận diện `viewerId` và trả về `isLiked = true/false` chính xác cho từng bình luận.
  - Cập nhật DTO `SocialCommentDto` trả về thêm `likeCount` và `isLiked`.
  - Chạy `pnpm contracts:build` xuất lại [core-api.json](file:///D:/HCMUT/vinAI/vsf/ota-tripflix/tripflix/tripflix-be/contracts/openapi/core-api.json) đồng bộ cho Frontend và Mobile.
- **Bộ kiểm thử E2E Toàn diện (`comment-reactions.e2e.spec.ts`)**:
  - 9/9 tests pass 100%:
    1. Không có token -> 401 Unauthorized.
    2. Comment không tồn tại -> 404 Not Found.
    3. User A thả tim toggle lần đầu -> 200 OK, `isLiked: true`, `likeCount: 1`.
    4. User A gửi lại `type="like"` (idempotent) -> 200 OK, `likeCount: 1`, `isLiked: true`.
    5. User B cũng thả tim -> 200 OK, `isLiked: true`, `likeCount: 2`.
    6. Khách vãng lai gọi `GET /api/v1/posts/:postId/comments` -> `likeCount: 2`, `isLiked: false`.
    7. User A gọi `GET /api/v1/posts/:postId/comments` -> `likeCount: 2`, `isLiked: true`.
    8. User A hủy thích `type=null` -> 200 OK, `isLiked: false`, `likeCount: 1`.
    9. User B toggle bỏ thích -> 200 OK, `isLiked: false`, `likeCount: 0`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bảng `content.comment_reactions` & foreign key `fk_comment_reactions_comment_id` | Đạt | Migration `20261105100003_minor_solo` |
| Bảng `content.comments` có cột `like_count` atomic | Đạt | `incrementLikeCount` dùng `GREATEST(like_count + delta, 0)` |
| API `PUT /api/v1/comments/:commentId/reaction` (Idempotent toggle / like / unlike) | Đạt | `comment-reactions.e2e.spec.ts` (9 tests pass) |
| API `GET /api/v1/posts/:postId/comments` trả kèm `likeCount` và `isLiked` theo ngữ cảnh người xem | Đạt | `comment-reactions.e2e.spec.ts`, `SocialCommentDto` |
| OpenAPI Schema cập nhật chuẩn camelCase | Đạt | `contracts/openapi/core-api.json` |
| Quality Gates (boundaries, lint, typecheck, tests) | Đạt | 0 lỗi boundaries, 0 lint errors, 23 packages typecheck pass, 49/49 test files pass (365/365 tests) |

## Kết quả kiểm tra
- `node tools/check-boundaries.mjs`: Ranh giới module: không có vi phạm.
- `pnpm lint`: Found 0 errors, 13 packages lint pass.
- `pnpm typecheck`: 23 successful, 23 total.
- `pnpm --filter @tripflix/core-api test -- src/modules/content/social`: 9 passed, 117 passed (117).
- `pnpm --filter @tripflix/core-api test`: 49 passed, 375 passed (375).
- `pnpm contracts:build`: Đã build thành công OpenAPI và contracts/openapi/core-api.json.

## Các cải tiến kỹ thuật toàn diện cho Social & Content (Roadmap TF25)
1. **Chống Race Condition & Đảm bảo tính nhất quán (Giai đoạn 1)**:
   - Sử dụng atomic `insertIfAbsent` (`ON CONFLICT DO NOTHING RETURNING id`) và `delete (... RETURNING id)` trong `SetCommentReactionUseCase`, đảm bảo chỉ tăng/giảm `likeCount` khi hàng thực sự được thêm/xóa.
   - Thêm `findByIdForUpdate` (khóa bi quan `SELECT ... FOR UPDATE`) trong `SetReactionUseCase` để chống mất cập nhật bộ đếm cảm xúc bài viết khi nhiều user tương tác đồng thời.
   - Giới hạn độ dài bình luận tối đa 2.000 ký tự (Domain entity `MAX_BODY_LENGTH = 2_000`, DTO `maxLength(2000)`). Thêm `InvalidCommentBodyException` vào domain errors và map sang HTTP 400 trong `SocialErrorFilter` (trả 400 Bad Request rõ ràng thay vì văng 500 khi client gửi body rỗng hoặc vượt quá 2.000 ký tự).
   - Hạ `promptVersion` trong Zod Schema xuống `max(32)` khớp chính xác với constraint DB `varchar(32)`. Dọn dẹp các fallback `snake_case` cũ trong DTO.
2. **Bảo vệ quyền riêng tư & Tính toàn vẹn dữ liệu (Giai đoạn 2)**:
   - Áp dụng kiểm tra quyền xem bài viết `domainPost.canBeViewedBy(authorId)` ngay trong `AddCommentUseCase`, ngăn người dùng tạo bình luận vào bài đăng `draft`, `hidden`, `private` hoặc `removed` (ném `PostNotFoundException` trả 404 để không xác nhận sự tồn tại của bài viết).
   - Kiểm tra quyền xem bài viết `domainPost.canBeViewedBy(viewerId, isStaff)` cho cả `ListCommentsUseCase` (`GET /api/v1/posts/:postId/comments`) và `GetPostSummaryUseCase` (`GET /api/v1/posts/:postId/ai-summary`).
   - Kiểm tra `parentCommentId` chặt chẽ trong `AddCommentUseCase`: nếu cha không tồn tại hoặc thuộc bài viết khác thì ném `CommentNotFoundException` (trả 404), chống văng HTTP 500 do foreign key constraint.
   - Cung cấp `softDeleteWithReplies` trong `CommentRepository` và cập nhật `DeleteCommentUseCase`: Nếu `deletedRecords.length === 0` (bình luận đã bị xóa đồng thời trước đó), ném ngay `CommentNotFoundException`, không bịa số 1, không trừ duplicate `commentCount` và không phát event trùng. Khi xóa thật, cascade soft-delete toàn bộ các phản hồi con và trừ `commentCount` của bài viết theo đúng tổng số dòng bị ẩn, phát sự kiện outbox tương ứng cho từng bình luận bị xóa để AI worker đồng bộ lại.
   - Đưa việc gọi kiểm tra booking (`verifyCompletedBooking`) ra ngoài transaction DB trong `PublishPostUseCase`, tránh giữ kết nối database pool khi gọi external network.
3. **Compare-and-Swap cấp Database & Cảnh báo dữ liệu cũ cho AI Summary (Giai đoạn 3)**:
   - Cơ chế CAS ở tầng Database Postgres cho `SavePostSummaryUseCase` (`PUT /api/v1/posts/:postId/ai-summary`) qua `saveIfNewer`: Mệnh đề SQL `ON CONFLICT (post_id) DO UPDATE WHERE (post_summaries.generated_at IS NULL OR excluded.generated_at >= post_summaries.generated_at) AND NOT (post_summaries.status = 'ready' AND excluded.status = 'failed')`. Ngăn triệt để worker cũ ghi đè worker mới ở cấp concurrency DB; không ghi đè trạng thái `failed` lên bản ghi đã `ready` trước đó (giữ lại nội dung tốt cho người dùng). Bắt buộc `generatedAt` hợp lệ (ISO 8601).
   - Bổ sung cờ `isStale: boolean` chuẩn xác trong `GetPostSummaryUseCase` và `PostSummaryResponseDto`: Đánh dấu `true` khi số lượng comment hiện tại của bài viết lệch so với `commentCountAtSummary` HOẶC có bình luận mới/chỉnh sửa nội dung sau mốc `generatedAt` (`hasDiscussionChangedSince`).
   - Thao tác thả tim (`incrementLikeCount`) không đụng tới cột `updated_at` của bình luận, tránh làm cờ `isStale` bị kích hoạt sai khi người dùng tương tác.
   - Dọn dẹp trường `id` thừa trong `PostSummaryResponseDto`, phòng thủ `resolveLimit` chống `NaN` trong `ListCommentsUseCase`, và trả `isLiked` thật trong `editComment`.
   - Cập nhật OpenAPI documentation với `PostSummaryResponseDto`.

## Cách kiểm lại
1. Chạy migration: `pnpm db:migrate`
2. Kiểm tra boundaries và lint: `pnpm lint`
3. Kiểm tra kiểu: `pnpm typecheck`
4. Chạy toàn bộ test suite: `pnpm --filter @tripflix/core-api test`

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng tiêu cực. Đã bổ sung 2 trường `likeCount` và `isLiked` vào `SocialCommentDto` theo đúng thỏa thuận phối hợp với anh Phong và Trang (Frontend/Mobile).
- Toàn bộ thay đổi nằm trong phân hệ `content/social` và `content/db` do Thành phụ trách / đồng sở hữu.
