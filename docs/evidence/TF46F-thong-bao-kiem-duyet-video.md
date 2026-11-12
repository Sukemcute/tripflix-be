# TF46F — Thông báo kiểm duyệt bài và trạng thái video

- Task SCRUM-83 · Nhánh `dung/TF46F-thong-bao-kiem-duyet-video` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- Tác giả nhận thông báo inbox khi bài bị ẩn, gỡ hoặc khôi phục. Lý do ẩn và gỡ dùng nhãn tiếng Việt theo mã lý do.
- Ẩn thông báo tương tác trỏ tới bài khi kiểm duyệt ẩn hoặc gỡ. Ghi trạng thái kiểm duyệt cùng transaction để chặn thông báo bình luận giao muộn.
- Người tải lên nhận thông báo inbox khi video phát được hoặc xử lý thất bại. Nội dung inbox lỗi dùng lời nhắn chung.
- Phát cập nhật qua WebSocket. Push thuộc TF46K.
- Dùng sự kiện có sẵn trên `develop`, không đổi producer hoặc contract. Migration 5 dùng số riêng với migration 4 trên PR TF46E.

## Đối chiếu tiêu chí nghiệm thu

| Tiêu chí | Bằng chứng |
|---|---|
| Ẩn, gỡ và khôi phục báo đúng tác giả | Test tích hợp xác nhận loại thông báo, lý do tiếng Việt và chống ghi trùng |
| Ẩn tương tác và xử lý sự kiện đến muộn | Test tích hợp xác nhận không ảnh hưởng bài khác, giữ tương tác mới sau khi khôi phục và ẩn tương tác cũ |
| Video xong hoặc lỗi báo đúng người tải lên | Test tích hợp xác nhận hai trạng thái, chống giao trùng và không đưa lỗi kỹ thuật vào inbox |

## Kết quả kiểm tra

- `pnpm --filter @tripflix/notification-service test:int` pass 29/29 trên Docker local sau khi cập nhật develop.
- `pnpm turbo run lint typecheck test --affected --output-logs=errors-only` pass 49/49 tác vụ khi chạy riêng. Lần chạy song song bị timeout ở hook khởi tạo của suite upload video Core API.
- Đã kết hợp TF46E #162 từ develop. Luồng cảm xúc kiểm tra trạng thái bài và giữ ẩn nhóm cũ khi người dùng thích lại sau khôi phục. Chưa kiểm trên staging.

## Cách kiểm lại

1. Dùng tài khoản kiểm duyệt ẩn hoặc gỡ một bài có tương tác. Mở hộp thư của tác giả và người từng nhận thông báo tương tác để kiểm lý do và số chưa đọc.
2. Khôi phục bài, kiểm thông báo mới của tác giả và tương tác mới sau khôi phục.
3. Tải video thành công, rồi kiểm một lượt xử lý lỗi trong môi trường local để xác nhận thông báo đi đúng tài khoản tải lên.

## Ảnh hưởng tới phần của người khác

- Thay đổi giới hạn trong Notification Service của Dũng. Dùng các event có sẵn của Kiểm duyệt và Media.
