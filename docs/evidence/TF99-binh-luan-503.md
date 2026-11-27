# TF99 — Bình luận trả 503 kèm Retry-After khi database quá tải

- Jira: TF99 · Nhánh: `thanh/TF99-binh-luan-503` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-27
- Liên quan: đo tải staging trong `docs/evidence/TF99-do-tai-theo-vus.md` (PR #338).

## Đã làm
- Khi đo tải trên staging, quá tải làm request chờ mượn kết nối pool quá `connectionTimeoutMillis` (3 s), lỗi `timeout exceeded when trying to connect` của pg đi thẳng ra **500**. Client không phân biệt được lỗi tạm với lỗi code, số đo cũng lẫn hai loại.
- `SocialErrorFilter` (`content/social/api/social-error.filter.ts`) bắt mọi lỗi thay vì chỉ `DomainException`:
  - Lỗi nghiệp vụ: giữ nguyên mã như cũ (404, 403, 409, 400, 422).
  - Database không phục vụ được (chờ pool quá hạn, mất kết nối, quá số kết nối, máy chủ đang tắt): **503**, header `Retry-After: 5`, body `{ statusCode: 503, message, reason: 'SERVICE_UNAVAILABLE' }`, giống cách commerce và discovery đang trả.
  - Lỗi khác (HttpException, lỗi code): để Nest xử lý như trước.
- Dùng lại `isDatabaseUnavailable()`, `DATABASE_UNAVAILABLE_MESSAGE`, `RETRY_AFTER_SECONDS` qua `commerce/index.ts` (đúng ranh giới module, không sửa code commerce).
- Gắn `SocialErrorFilter` cho `CommentControlsController` (cài đặt bình luận, hàng duyệt của chủ bài), trước đó chưa có filter.
- Filter dùng chung cho các controller của social nên bài viết, reaction, bookmark cũng trả 503 khi database quá tải.
- Việc này chỉ làm lỗi báo đúng hơn, không làm hệ thống chịu được nhiều tải hơn.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chờ pool quá hạn trả 503 kèm Retry-After thay vì 500 | Có | `social-error.e2e.spec.ts`: "returns 503 with Retry-After when the database pool times out under load" (lỗi bọc trong `cause` như Drizzle) |
| Lỗi nghiệp vụ giữ nguyên mã cũ | Có | 4 test cũ trong `social-error.e2e.spec.ts` vẫn pass |
| HttpException và lỗi code không bị đổi | Có | "leaves HTTP exceptions and code bugs to Nest as before" (400, 500) |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: lint, typecheck pass (48/49 task). `@tripflix/core-api#test` chạy song song có 33 test fail ở 19 file của module khác (access, commerce, media, moderation, discovery, seed reels), lỗi hết thời gian chờ do máy quá tải.
- Chạy lại tuần tự (`vitest run --no-file-parallelism`) 11 file fail đó cùng toàn bộ `content/social`: 34/34 file, 408/408 test pass.
- `vitest run src/modules/content/social/api/social-error.e2e.spec.ts`: 6/6 pass.

## Cách kiểm lại
1. `cd apps/core-api && npx vitest run src/modules/content/social/api/social-error.e2e.spec.ts`
2. Hoặc chạy đo tải `tools/bench/comments` tới mức quá tải: response lỗi khi chờ pool là 503 kèm `Retry-After`, không còn 500.

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. Chỉ import hàm công khai từ `commerce/index.ts` (Thắng), như discovery đang làm.
