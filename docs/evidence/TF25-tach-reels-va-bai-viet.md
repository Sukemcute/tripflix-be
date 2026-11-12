# TF25 — Tách bạch Reels và Bài viết (backend)

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `thanh/TF25-tach-reels-va-bai-viet` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-12

## Đã làm
- **Bài viết (vlog) không được kèm video, Reels bắt buộc có video**: quy tắc ở domain `Post` (`assertMediaAllowedForPostType`), áp dụng khi tạo nháp, chỉnh sửa và xuất bản (kể cả bản nháp cũ đã lỡ gắn video). `media_assets` chỉ chứa video nên vlog có media sẽ lọt vào luồng Reels.
- **`GET /v1/posts`**: `post_type` trong hợp đồng chỉ còn `vlog`. Không truyền thì vẫn trả mọi loại vì AI service đang duyệt toàn bộ bài qua endpoint này; giá trị `video` vẫn được chấp nhận để client cũ không lỗi.
- **`GET /v1/me/bookmarks`, `GET /v1/me/posts`**: thêm `post_type=vlog`, lọc trong câu SQL trước phân trang; giá trị khác trả 400.
- **`GET /v1/feed`** (phần của Phong, đã đồng ý):
  - Chỉ lấy bài `post_type='video'`.
  - Thẻ có thêm `tripAttachment` (đã ẩn `bookingId`).
  - Thêm `saved=true`: Reels người xem đã lưu, cần đăng nhập (401), chỉ dùng với `for_you` (400), không qua cache.
  - Đổi khoá cache trang đầu sang `v2`.
- Sinh lại `contracts/openapi/core-api.json`.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bài viết không lẫn vào Reels, kể cả dữ liệu cũ | Có | `feed.int.spec.ts` › bài viết (vlog) cũ lỡ kèm video vẫn không lọt vào feed Reels |
| Không tạo/sửa/đăng được vlog kèm video | Có | `post.entity.spec.ts`, `social-use-cases.spec.ts` › chặn tạo bài viết (vlog) kèm video |
| Tab Bài viết, Đã lưu, Bài của tôi lọc được vlog trước phân trang | Có | `bookmark.repository.int.spec.ts`, `social.controllers.spec.ts` |
| Reels đã lưu có link phát, đúng người xem | Có | `feed.int.spec.ts` › saved chỉ trả Reels…; `feed.e2e.spec.ts` › saved=true 401/200 |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: lint 0 lỗi, typecheck sạch, **2157 test pass, 1 skip**.
- `vitest --config vitest.int.config.ts src/modules/content/feed src/modules/content/social/infra` (PostgreSQL thật qua Testcontainers): **15/15 pass**.

## Cách kiểm lại
1. `pnpm install && pnpm turbo run lint typecheck test --filter=@tripflix/core-api`
2. Có Docker: `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/feed src/modules/content/social/infra`
3. `pnpm contracts:build` rồi `git diff contracts/`: không có thay đổi.

## Ảnh / video
- Không đổi giao diện ở repo này; ảnh/video ở PR FE cùng tên nhánh.

## Ảnh hưởng tới phần của người khác
- Có: `content/feed` (Phong): lọc `post_type`, `tripAttachment`, `saved=true`, khoá cache `v2`, sửa kỳ vọng tên khoá trong `feed.use-cases.spec.ts`. Phong đã đồng ý.
- AI service (Bảo): `GET /v1/posts` không truyền `post_type` vẫn trả mọi loại, không cần sửa.
