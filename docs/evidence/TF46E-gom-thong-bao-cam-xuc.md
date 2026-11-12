# TF46E — Gom thông báo cảm xúc

- Task SCRUM-82 · Nhánh `dung/TF46E-gom-thong-bao-cam-xuc` · Dũng (có dùng AI) · 2026-11-12

## Đã làm

- Thông báo cho tác giả bài hoặc tác giả bình luận, bỏ lượt tự thích.
- Gom lượt đầu theo người nhận, đối tượng và cửa sổ cố định 2 phút. Lượt đầu của người khác có thể tạo nhóm mới nếu nhóm trước đã đọc.
- Lưu trạng thái theo từng người và đối tượng. Đổi loại cảm xúc giữ nguyên số đếm. Bỏ thích giảm số đếm và ẩn nhóm nếu về 0. Thích lại cập nhật nhóm cũ và giữ trạng thái đã đọc nếu nhóm từng bị ẩn.
- Phát `notification.created` khi tạo nhóm. Các thay đổi số đếm dùng tín hiệu tải lại inbox mà Web đã hỗ trợ.
- Bổ sung `postAuthorId` tùy chọn vào event v1. Event cũ tra `post_directory` nếu đã có dữ liệu tác giả.

## Đối chiếu tiêu chí nghiệm thu

| Tiêu chí | Bằng chứng |
|---|---|
| 20 người thích trong một phút chỉ tạo một thông báo, đếm đúng | Test tích hợp gọi đồng thời 20 event và một bản giao trùng, xác nhận số đếm 20 và một lần phát thông báo mới |
| Bỏ tự thích, bỏ thích, thích lại không báo thêm | Test tích hợp xác nhận cả ba trường hợp, gồm thích lại sau khi đã sang cửa sổ mới |
| Phân biệt lượt đến muộn và bình luận đã bị xóa | Test tích hợp kiểm event có thời điểm cũ hơn và chặn thông báo đến sau khi xóa bình luận |
| Tối đa một push trong cửa sổ | Chờ luồng push TF46K. Phạm vi lần này là inbox và realtime |

## Kết quả kiểm tra

- `pnpm contracts:build` thành công.
- `pnpm turbo run lint typecheck test --affected --output-logs=errors-only` thành công, 49/49 tác vụ. Suite Core API có một test parity được bỏ qua theo cấu hình hiện có.
- `pnpm --filter @tripflix/notification-service test:int` thành công, 24/24 test trên Docker local.
- Chưa kiểm thử trên staging. Event có cùng `occurredAt` của cùng người và đối tượng áp dụng theo thứ tự xử lý khi event ID khác nhau.

## Cách kiểm lại

1. Tạo bài bằng tài khoản A. Dùng B để thích rồi mở tab Tương tác của A. Inbox hiển thị một nhóm với số đếm 1.
2. Dùng B để bỏ thích rồi thích lại. Inbox của A ẩn nhóm khi số đếm về 0 và hiện lại cùng nhóm với số đếm 1. Badge không tăng lại.
3. Với bài khác của A, dùng B và C để thích lần đầu trong cùng cửa sổ 2 phút. Để nhóm ở trạng thái chưa đọc. Inbox có một nhóm với số đếm 2. Thử thêm lượt thích bình luận để kiểm tra tác giả bình luận nhận đúng nhóm.

## Ảnh hưởng tới phần của người khác

- Content Social của Thành thêm một trường vào payload event và kiểm trường đó trong test sẵn có. Người dùng đã duyệt phạm vi. Event cũ vẫn hợp lệ.
