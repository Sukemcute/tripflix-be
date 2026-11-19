# TF25 — Thông báo khi được tag trong bình luận

- Nhánh: `dung/TF25-thong-bao-tag` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-19
- Phụ thuộc: social phát `mentionedUserIds` (PR #285, đã merge)

## Đã làm
- `libs/contracts`: `ContentCommentCreatedV1Schema` thêm `mentionedUserIds?: string[]` (UUID, không trùng, tối đa 10); sinh lại `contracts/events/content.comment.created.v1.schema.json`.
- notification-service: loại mới `comment.mentioned`, nội dung "X đã nhắc đến bạn trong một bình luận." Đi chung đường `CommentNotificationRepository.create` của TF46 (khóa theo bình luận, chặn bình luận đã xóa, chặn bài bị ẩn).
- Chỉ báo khi `postVisibility = 'public'`; bỏ người tự tag; người đã nhận thông báo chủ bài/trả lời cho cùng bình luận thì không nhận thêm.
- Chống trùng theo (bình luận, người nhận) bằng `NOT EXISTS` trong SQL, kể cả khi sự kiện phát lại với `eventId` khác.
- Bình luận bị giữ phát `content.comment.held` (không có handler) nên không báo; sửa bình luận phát `content.comment.updated`, không có tag mới nên không báo.
- Người được tag nhận thông báo tag thay cho dòng gom "trả lời trong luồng" (N2) của cùng bình luận.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Contract có `mentionedUserIds` | ✅ | `libs/contracts/src/index.spec.ts` — TF25 |
| Đăng ngay | ✅ | `comment-notification.int.spec.ts` — "đăng ngay" |
| Chủ bài duyệt | ✅ | int spec — "chủ bài duyệt" |
| Nền tảng gỡ giữ sau hai lớp giữ | ✅ | int spec — "nền tảng gỡ giữ" |
| Event lặp | ✅ | int spec — "event lặp" |
| Không báo thêm cho chủ bài/người được trả lời | ✅ | int spec + `comment-moderation.spec.ts` |
| Tự tag | ✅ | int spec + `comment-moderation.spec.ts` |
| Bài private | ✅ | int spec + `comment-moderation.spec.ts` |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck --affected`: 36/36 task pass (notification-service có 4 cảnh báo cũ ở `follower-post.int.spec.ts`, `push.int.spec.ts`).
- `pnpm turbo run test --filter=@tripflix/contracts --filter=@tripflix/notification-service`: contracts 25/25, notification-service 140/140.
- Int test (cần Docker): `pnpm --filter @tripflix/notification-service test:int -- comment-notification` — điền kết quả sau khi chạy.

## Cách kiểm lại
1. `pnpm install && pnpm turbo run lint typecheck test --affected`
2. Bật Docker, chạy lệnh int test ở trên.

## Ảnh hưởng tới phần của người khác
- Không sửa code của người khác. Dùng field `mentionedUserIds` do social (Thành) phát.
