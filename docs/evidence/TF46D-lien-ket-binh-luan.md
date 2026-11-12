# TF46D — Hiện tên và mở đúng bình luận từ thông báo

- Nhánh `dung/TF46D-lien-ket-binh-luan` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- Sự kiện bình luận mới kèm tên hiển thị lấy qua User Directory của Core. Notification Service dùng tên này hoặc bản đồng bộ trong directory.
- Link inbox mở bài với ID bình luận. API danh sách hỗ trợ `focusCommentId` để trả bình luận đích và bình luận cha nếu có, sau khi kiểm quyền xem bài và trạng thái của bình luận.
- Thông báo cũ đã có ID bài và bình luận có thể được Web điều hướng lại. Nội dung tên đã ghi của các thông báo cũ không được cập nhật hồi tố.

## Kết quả kiểm tra

- `pnpm contracts:build` thành công.
- `pnpm turbo run lint typecheck test --affected --output-logs=errors-only` pass 49/49 tác vụ, gồm test API tìm đúng lượt trả lời và từ chối hiển thị khi bình luận cha đã ẩn.
- `pnpm --filter @tripflix/notification-service test:int --maxWorkers=1` pass 30/30 sau khi cập nhật develop và giữ kiểm tra trạng thái bài của TF46F.
- Chưa kiểm bằng trình duyệt hoặc staging.

## Cách kiểm lại

1. Dùng tài khoản B bình luận vào bài của A. A thấy tên B và bấm thông báo để mở đúng bình luận.
2. Lặp lại với lượt trả lời nằm ngoài trang đầu. Sau đó ẩn bình luận cha và mở lại đường dẫn để kiểm trạng thái không còn hiển thị.

## Ảnh hưởng tới phần của người khác

- Content Social của Thành và Notification Service của Dũng nằm trong phạm vi người dùng đã duyệt. Các trường mới là tùy chọn.
