# TF07 — Giữ bộ đếm khi chạy seed và đồng bộ số liệu thực tế

- Jira: [SCRUM-10](https://tripflix.atlassian.net/browse/SCRUM-10) · Nhánh: `thanh/TF07-giu-bo-dem-khi-seed` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-10
- Phạm vi: sửa lỗi `seedContent` ghi đè các cột bộ đếm bài viết (`commentCount`, `reactionCounts`, `reactionTotal`, `shareCount`, `bookmarkCount`) mỗi khi chạy lại `db:seed`.

## Đã làm
- Lỗi: `seed-content.ts` khi upsert bài viết (`posts`) trong `onConflictDoUpdate` đã đặt `commentCount: sql`excluded.comment_count`` và các cột đếm khác. Mỗi lần `db:seed` chạy lại (ví dụ khi dựng stack docker compose ở local), các bộ đếm bị ghi đè về số tĩnh trong `posts-seed.json`, làm sai lệch số đếm phát sinh thực tế (điển hình là `posts.comment_count` bị tụt về 0 rồi thành 1 dù bài có 2 bình luận hiển thị).
- `apps/core-api/src/modules/content/db/seed/seed-content.ts`:
  - Bỏ các cột bộ đếm (`reactionCounts`, `reactionTotal`, `commentCount`, `shareCount`, `bookmarkCount`) khỏi `set` của `onConflictDoUpdate` trên bảng `posts`. Lần đầu insert vẫn nạp số mồi, các lần chạy seed sau giữ nguyên số đếm hiện tại trong database.
  - Sau bước seed bình luận và cảm xúc, thực hiện đồng bộ lại `posts.comment_count` theo số lượng bình luận hiển thị thực tế (`status = 'visible'` và `deleted_at IS NULL`), đồng thời đồng bộ `posts.reaction_total` và `posts.reaction_counts` theo bảng `reactions`.
- `apps/core-api/src/modules/content/db/seed/posts-seed.json`: bổ sung các bản ghi cảm xúc (`reactions`) tương ứng với số mồi ban đầu để dữ liệu đồng nhất.
- `apps/core-api/src/modules/content/db/seed/seed-content.spec.ts`: cập nhật mock transaction và bổ sung assert kiểm tra `onConflictDoUpdate` không ghi đè các cột bộ đếm.

## Đối chiếu
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Chạy lại `db:seed` không làm mất số đếm thực tế của bài viết | Đạt | Bỏ các cột bộ đếm khỏi `onConflictDoUpdate` của `posts` |
| `posts.comment_count` khớp đúng số bình luận hiển thị thực tế | Đạt | Đồng bộ `commentCount` với điều kiện `status = 'visible' AND deleted_at IS NULL` |
| Bộ test unit và kiểm tra của core-api pass | Đạt | `seed-content.spec.ts` pass 5/5 test; lint & typecheck sạch |

## Kết quả kiểm tra
- `vitest run src/modules/content/db/seed/seed-content.spec.ts`: 5/5 passed.
- `pnpm turbo run lint typecheck --filter=@tripflix/core-api`: 12/12 tasks successful, 0 errors.

## Cách kiểm lại
1. Chạy `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/db/seed/seed-content.spec.ts`.
2. Kiểm tra `onConflictDoUpdate` trong `seed-content.ts` không còn cập nhật `commentCount`, `reactionCounts`, `reactionTotal`, `shareCount`, `bookmarkCount`.

## Ảnh hưởng tới phần của người khác
- Không ảnh hưởng tới API contracts hay các module khác (`access`, `commerce`, `discovery`, `analytics`). Chỉ ảnh hưởng nội bộ logic seed của module `content` (Thành, Phong).
