# TF25 — Danh sách bình luận trả tên tác giả (qua AccessFacade)

- Jira: [SCRUM-29](https://tripflix.atlassian.net/browse/SCRUM-29) · Nhánh: `trang/TF25-ten-tac-gia-binh-luan` · Người làm: Lê Thị Thùy Trang (dùng AI: có) · Ngày: 2026-11-09
- Phạm vi: một lỗi nhỏ trong TF25 (tên người bình luận), không phải toàn bộ task TF25.

## Đã làm
- Lỗi: `GET /api/v1/posts/:postId/comments` chỉ trả `authorId`, nên web hiện người khác thành "Thành viên xxxxxx"; chỉ tên của chính mình là đúng.
- `access/access.facade.ts` (mới): `AccessFacade.getDisplayNames(userIds)`, chỉ đọc, bỏ id không phải UUID, export qua `access/index.ts` và `AccessModule`.
- `access/auth/application/ports.ts`: `UserRepository.findByIds`; cài ở `drizzle-access.store.ts` và `memory-access.store.ts`.
- `content/social/application/ports/user-directory.port.ts` (mới): `UserDirectoryPort`. `ContentModule` import `AccessModule`, nối port vào `AccessFacade` (giống discovery dùng `CommerceFacade`). Content không đọc bảng của access.
- `ListCommentsUseCase`: gắn `authorName` cho từng bình luận; lỗi tra tên không làm hỏng danh sách (`authorName = null`).
- `SocialCommentDto`: thêm `authorName` (nullable, không bắt buộc). Chỉ thêm trường, client cũ không ảnh hưởng.

## Đối chiếu
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Bình luận của người khác trả đúng tên hiển thị | Đạt | `authorName` trong response danh sách bình luận |
| Content không đọc thẳng bảng `access.users` | Đạt | chỉ gọi `AccessFacade` qua `UserDirectoryPort` |
| Test pass | Đạt | xem bên dưới |

## Kết quả kiểm tra
- `tsc --noEmit` core-api sạch.
- `vitest run` core-api: 59 file test pass, 652 test pass, 1 skip có sẵn.

## Cách kiểm lại
1. Đăng nhập 2 tài khoản, mỗi tài khoản bình luận vào cùng một bài.
2. `GET /api/v1/posts/:postId/comments`: mỗi item có `authorName` đúng tên hiển thị của người viết.

## Ảnh / video
- Web hiển thị tên ở PR tripflix-fe cùng nhánh.

## Ảnh hưởng tới phần của người khác
- Có: module `access` của Dũng (thêm facade + `findByIds`, không đổi hàm có sẵn) và module `content` (thêm port, `ContentModule` import `AccessModule`). Không đổi schema database.
