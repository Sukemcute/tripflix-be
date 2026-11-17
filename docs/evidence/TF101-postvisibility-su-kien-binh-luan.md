# TF101 (phần a-1) — Gửi postVisibility trong mọi sự kiện bình luận

- Jira: [SCRUM-125](https://tripflix.atlassian.net/browse/SCRUM-125) · Nhánh: `trang/TF101-an-binh-luan-realtime` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-16
- Kế hoạch: `docs/moderation/07-ke-hoach-tf101-an-binh-luan-realtime.md` (thư mục tài liệu dự án). Đây là PR đầu trong 4 PR của TF101.

## Đã làm
- Vấn đề: bình luận bị tự ẩn vẫn hiện trên máy người đang xem bài cho tới khi tải lại. notification-service (TF99) chỉ phát tín hiệu `post.comments.changed` vào phòng `post:<postId>` khi sự kiện có `postVisibility = 'public'`, nhưng core-api chưa gửi trường này ở sự kiện nào, nên realtime bình luận (cả bình luận thường) chưa bao giờ chạy.
- Thêm `postVisibility` (lấy từ bài đang khoá trong transaction) vào:
  - `social`: `content.comment.created` (thêm mới), `content.comment.updated` (sửa), `content.comment.deleted` (xoá).
  - `moderation` (`ChangeVisibilityUseCase`): `content.comment.hidden`, `content.comment.restored`, `content.comment.deleted` (gỡ), `content.comment.created` (nhả bình luận held).
- Trường đã có trong hợp đồng sự kiện (tuỳ chọn, thêm ở #195), nên **không đổi** `contracts/` hay notification-service.
- Bài private gửi `postVisibility = 'private'`: notification không phát vào phòng của bài, đúng thiết kế TF99.

## Đối chiếu "Xong khi" (phần của PR này)
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Mọi sự kiện bình luận có `postVisibility` đúng với bài public/private | ✅ | `moderation.int.spec.ts` › "mọi sự kiện bình luận mang postVisibility…" (Postgres thật, đủ 5 loại sự kiện; bài private ra `private`). Bỏ trường ở moderation thì test fail |
| Lint/typecheck/test pass | ✅ | Mục "Kết quả kiểm tra" |
| Tác giả thấy dòng "vi phạm Tiêu chuẩn cộng đồng"; Web/Mobile tải lại realtime; không thông báo khi tự ẩn | — | Các PR sau của TF101 (a-2 chờ #212 merge vì cùng sửa `list-comments`, `comment.repository`; b notification; c Web; d Mobile) |

## Kết quả kiểm tra
- `vitest run --config vitest.int.config.ts src/modules/content` (Postgres thật): 14 file, 94/94 pass. Cập nhật kỳ vọng của test cũ "ẩn gốc cascade…" (so nguyên payload) thêm `postVisibility: 'public'`.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task. core-api 2539 pass (4 skip có sẵn), notification-service 121/121.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/moderation` (cần Docker)

## Ảnh / video
- Không đổi giao diện ở PR này. Ảnh realtime sẽ có ở PR Web (TF101c).

## Ảnh hưởng tới phần của người khác
- Có: `content/social` (`add-comment`, `edit-comment`, `delete-comment`, chủ Thành). Chỉ thêm một trường vào payload sự kiện, không đổi logic hay chữ ký. Thành duyệt.
- notification-service (Dũng): không sửa code; bắt đầu nhận `postVisibility` nên tín hiệu realtime bình luận được phát.
