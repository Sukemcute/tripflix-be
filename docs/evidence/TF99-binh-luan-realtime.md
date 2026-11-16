# TF99 — Bình luận realtime (phần notification-service)

- Notion: TF99 · Nhánh: `dung/TF99-binh-luan-realtime` (phụ thuộc PR #195) · Người làm: Dũng (dùng AI: có) · Ngày: 2026-11-16

## Mục đích
Người đang mở một bài thấy bình luận mới, bình luận sửa/xoá, và bình luận bị kiểm duyệt ẩn/hiện lại ngay trên màn hình, không phải tải lại trang. Phần này của notification-service chỉ báo "bài này vừa đổi bình luận"; web (anh Thành) nhận tín hiệu rồi tải lại danh sách.

## Đã làm
- Gateway `/ws`: thêm `post.watch` / `post.unwatch` với body `{ postId }`. Kiểm `postId` là uuid, mỗi socket tối đa 3 phòng `post:<postId>`. Ack `{ ok: true }` hoặc `{ ok: false, code: 'invalid' | 'too_many' }`.
- `PostCommentSignals`: nghe `content.comment.created/updated/deleted/hidden/restored` (v1). Chỉ khi `postVisibility === 'public'` mới phát `post.comments.changed { postId, commentId, parentCommentId, kind, actorId, changeCount }` vào phòng. Thiếu field thì không phát, nên core chưa deploy cũng không lộ gì.
- Chỉ tín hiệu, không gửi nội dung bình luận. `actorId` là `null` với hidden/restored để không lộ kiểm duyệt viên.
- Gọi trong consumer trước khi ghi inbox, để tín hiệu không phải chờ các bước ghi database. Phát lỗi hoặc payload hỏng chỉ ghi log, không làm hỏng thông báo.
- Gom lô: mỗi bài, thay đổi đầu tiên phát ngay; thay đổi tới trong 250 ms sau đó được gom, cuối khoảng phát một lần với thay đổi mới nhất và `changeCount`. Bài ≤ 4 thay đổi/giây vẫn phát ngay từng cái.
- Đường phát giữ outbox 500 ms như đã thống nhất (phương án c).

## Đối chiếu "Xong khi"
| Tiêu chí (theo yêu cầu anh Thành) | Đạt | Bằng chứng |
|---|---|---|
| `post.watch`/`post.unwatch` vào phòng `post:<postId>`, kiểm uuid, tối đa 3 phòng | Có | `realtime.e2e.spec.ts` — "TF99: phòng bài post:<postId>" |
| Phát `post.comments.changed` cho bài public, chỉ tín hiệu | Có | `post-comment-signals.spec.ts` — "chỉ phát cho bài public…", "ánh xạ 5 loại sự kiện…" |
| hidden, deleted, restored cũng phát | Có | cùng test ánh xạ 5 loại |
| Bài nóng gom lô 250 ms | Có | "bài nóng: phát ngay cái đầu, gom phần còn lại…" (fake timers) |
| Phát lỗi chỉ ghi log | Có | "payload hỏng chỉ ghi log, phát lỗi không ném ra ngoài" |

## Kết quả kiểm tra
- `vitest run` (notification-service): 17 file, 121/121 pass.
- `vitest run --config vitest.int.config.ts` (notification-service): 8 file, 34/34 pass.
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: 49/49 task pass.

## Cách kiểm lại
1. `cd apps/notification-service && npx vitest run src/realtime`

## Ảnh / video
- Không đổi giao diện ở repo này.

## Ảnh hưởng tới phần của người khác
- Chỉ sửa `notification-service` (Dũng). Gateway trước đây không nhận tin từ client; nay nhận đúng hai tin `post.watch`/`post.unwatch`.
- Core (Thành): cần ghi `postVisibility` vào 5 sự kiện bình luận thì tín hiệu mới chạy.
- Web (Thành): gọi `socket.emitWithAck('post.watch', { postId })` khi mở bài, `post.unwatch` khi rời; nghe `post.comments.changed` rồi tải lại danh sách. Kết nối lại thì phải gửi lại `post.watch`.
- Giới hạn: gom lô tính riêng ở từng replica. Một sự kiện bị gửi lại thì phát thêm một tín hiệu, web chỉ tải lại thêm một lần.
