# TF46D — Trả lời bình luận trong cùng luồng

- Nhánh `dung/TF46D-tra-loi-trong-luong` · Dũng (có dùng AI) · 2026-11-13

## Đã làm

- Giữ cấu trúc bình luận một cấp và xác định đúng người được trả lời trong cùng luồng.
- Thông báo mới hiện tên người trả lời và mở đúng lượt mới. Migration thêm tên hiển thị của người được trả lời để nhãn còn sau khi tải lại.

## Kết quả kiểm tra

- 49/49 tác vụ lint, typecheck và test sau khi đồng bộ develop.
- 6/6 test tích hợp thông báo bình luận sau khi đồng bộ. Test repository bình luận trên PostgreSQL pass 1/1 trước khi đồng bộ.
- Chưa kiểm trên trình duyệt thật, Android hoặc staging.

## Cách kiểm lại

- A viết bình luận gốc. B trả lời A. C chọn trả lời trực tiếp B. Kiểm nhãn C ↳ B và bấm thông báo của B để mở bình luận mới của C.
- Triển khai migration và backend trước frontend. Bình luận cũ chưa có tên người được trả lời.

## Ảnh hưởng

- Thay đổi Content Social và Notification theo phạm vi người dùng yêu cầu.
