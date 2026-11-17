# TF46 — Theo dõi luồng trả lời (N2)

- Notion: TF46 (N2 theo yêu cầu của anh Thành) · Nhánh: `dung/TF46-theo-doi-luong-tra-loi` · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Migration notification số 8: bảng `thread_participants (parent_comment_id, user_id, joined_at)`.
- `CommentNotificationRepository.notifyThread`: từ `content.comment.created`, ghi tác giả bình luận gốc và người trả lời vào luồng, rồi báo những người còn lại trong luồng. Chạy trong cùng khoá bài và khoá bình luận như `create`, nên xoá đồng thời không làm hiện lại thông báo.
- Loại mới `comment.thread_replied`. Trừ người viết, chủ bài (đã có `comment.created`) và người được trả lời trực tiếp (đã có `comment.replied`), nên không ai nhận hai dòng cho cùng một bình luận.
- Gom theo `group_key` mỗi người mỗi luồng khi chưa đọc: "B và N người khác đã trả lời trong luồng bạn tham gia.", đếm mỗi người một lần (`data.actorIds`). Dòng mới phát `notification.created`, dòng gom được cập nhật phát `notification.read` (giống cảm xúc).
- Chỉ chạy khi sự kiện có `postVisibility === 'public'` (theo review của anh Thành): bài private hoặc sự kiện thiếu field thì không ghi người tham gia, không báo. Cần core ghi field này (sau PR #195) thì N2 mới chạy.
- Chỉ tính từ lúc triển khai, không backfill. Luồng có từ trước vẫn có tác giả gốc nhờ `parentCommentAuthorId` trong sự kiện.

## Đối chiếu "Xong khi"
| Tiêu chí (theo yêu cầu anh Thành) | Đạt | Bằng chứng |
|---|---|---|
| A bình luận, B trả lời A, D trả lời B: A cũng nhận | Có | `comment-notification.int.spec.ts` — "A bình luận, B trả lời A, D trả lời B…" |
| Người được trả lời trực tiếp vẫn nhận dòng riêng, không ai nhận hai dòng | Có | cùng test: B chỉ có `comment.replied`, chủ bài không có dòng luồng |
| Gom theo luồng như cảm xúc | Có | "gom vào dòng chưa đọc, đếm mỗi người một lần, gửi lại sự kiện không đổi gì" |
| Bài private hoặc thiếu postVisibility thì không báo | Có | "bài private hoặc sự kiện thiếu postVisibility thì không báo người trong luồng" |
| Đọc rồi thì trả lời sau tạo dòng mới | Có | "đọc rồi thì trả lời sau tạo dòng mới; xoá bình luận mới nhất thì ẩn dòng gom" |

## Kết quả kiểm tra
- `vitest run --config vitest.int.config.ts` (notification-service, Postgres thật qua Testcontainers): 8 file, 38/38 pass.
- `vitest run` (notification-service): 16 file, 112/112 pass.
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass.

## Cách kiểm lại
1. Bật Docker.
2. `cd apps/notification-service && npx vitest run --config vitest.int.config.ts src/inbox/comment-notification.int.spec.ts`

## Ảnh / video
- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- Đổi kỳ vọng một test cũ của chính TF46D (#170): tác giả bình luận gốc không được trả lời trực tiếp nay nhận dòng `comment.thread_replied` thay vì không nhận gì — đây là hành vi N2 yêu cầu.
- Web (Thành): loại mới `comment.thread_replied` mở bằng `link` `/trips/<postId>?comment=<id>` nên đi đúng chỗ; muốn icon riêng hoặc thêm vào `resolveNotificationHref` thì làm bên web.
- Giới hạn: dòng gom giữ id bình luận mới nhất, xoá bình luận đó thì ẩn cả dòng; xoá bình luận cũ hơn thì dòng vẫn giữ số người.
