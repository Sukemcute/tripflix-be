# TF103 — Sửa race khi sửa bình luận và căn thứ tự index pending

- Jira: [SCRUM-180](https://tripflix.atlassian.net/browse/SCRUM-180) · Nhánh: `trang/TF103-sua-race-edit-comment` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-19

## Đã làm

- Tính lại `creatorHeld` và `platformHeld` từ bình luận đã khoá, tránh ghi đè quyết định kiểm duyệt hoặc duyệt mới hơn.
- Căn `idx_comments_creator_pending` với thứ tự `created_at DESC, id DESC`; migration mới giới hạn chờ khoá 5 giây.
- Thêm hai test cạnh tranh: nền tảng gỡ giữ và chủ bài duyệt trong lúc sửa bình luận.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Thao tác sửa không khôi phục cờ kiểm duyệt cũ trong hai tình huống chen ngang | ✅ | `social-use-cases.spec.ts`: hai test mới; 85/85 test trong file pass |
| Index khớp thứ tự `created_at DESC, id DESC` | ✅ | `comments.ts` dùng `.nullsFirst()` cho cả hai cột; migration `20261119025701_wet_domino` |
| Kiểm tra liên quan pass | ✅ | `pnpm turbo run lint typecheck test --affected`: 49/49 tác vụ pass; 2,875 test pass, 4 skipped |

## Kết quả kiểm tra

- `pnpm --filter @tripflix/contracts build` — pass (build dependency cần cho typecheck của checkout).
- `pnpm turbo run lint typecheck test --affected` — pass; lint có cảnh báo sẵn trong repo nhưng không có lỗi.

## Cách kiểm lại

1. Chạy `pnpm --filter @tripflix/core-api test -- src/modules/content/social/application/use-cases/social-use-cases.spec.ts`.
2. Chạy `pnpm turbo run lint typecheck test --affected`.
3. Kiểm tra SQL trong `apps/core-api/src/modules/content/db/migrations/20261119025701_wet_domino/migration.sql`.

## Ảnh / video

- Không áp dụng (thay đổi backend).

## Ảnh hưởng tới phần của người khác

- Có: `content/social` (chủ Thành) và `content/db` (chủ Phong, Thành, Trang). Thành trực tiếp nhờ sửa hai mục này trong tin nhắn được cung cấp.
