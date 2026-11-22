# TF92 — Đúng người nhận và hàng chờ duyệt bình luận

- Phạm vi: yêu cầu trực tiếp trong chat; [SCRUM-120](https://tripflix.atlassian.net/browse/SCRUM-120).
- Nhánh: `trang/TF92-hoan-thien-duyet-binh-luan`. Ngày: 18/11/2026. Dùng AI: có.

## Đã làm

- Lưu `reply_to_comment_id` chính xác và snapshot tên tác giả từ UserDirectory hiện có. Migration thêm hai cột nullable, không backfill đích của bình luận cũ.
- Dùng chung payload cho đăng ngay, chủ bài duyệt và nền tảng nhả held. Trả lời C → B dưới gốc A gửi đúng B thay vì đoán A.
- Event thêm trường optional `replyRecipientKnown`: false nghĩa là dữ liệu cũ không xác định được đích, notification không dùng gốc làm người nhận trả lời trực tiếp. Event cũ không có trường này vẫn giữ tương thích.
- Bài private không gửi trả lời/excerpt cho người ngoài chủ bài.
- Hàng chờ dùng keyset `(created_at, id)`, có partial index; vẫn nhận numeric cursor cũ. Kiểm cursor không hợp lệ.
- Batch tải ngữ cảnh cùng bài; không trả tên/nội dung ngữ cảnh đã ẩn/gỡ/xóa. API trả `canApprove`, `willPublish`, `approvalBlockReason`, `parentContext`, `authorName`.
- Chặn approve khi bài/gốc chưa hiển thị, kể cả bình luận còn bị nền tảng giữ. Khóa bài/bình luận và tính đếm, outbox giữ trong transaction; không thêm gọi dịch vụ ngoài trong transaction.
- OpenAPI/event schema được sinh từ nguồn, không sửa tay artifact.

## Đối chiếu nghiệm thu

| Tiêu chí | Bằng chứng |
|---|---|
| Nhả held hoặc chủ bài duyệt giữ đúng ID/tác giả đích | Regression trong `moderation.int.spec.ts`; live Web ba tài khoản |
| Không đoán đích legacy; bảo vệ private | `comment-publication.spec.ts`, `comment-moderation.spec.ts`, `comment-notification.int.spec.ts` |
| Phân trang không bỏ sót khi duyệt và có bình luận mới | Integration keyset queue |
| Không lộ ngữ cảnh ẩn, chặn gốc/bài không khả dụng | Integration queue/capabilities và live Web, API 409 |
| Không vượt kiểm duyệt nền tảng, không đếm/gửi trùng | Integration moderation và live Web/API/inbox |

## Kiểm tra

- Core + Notification lint/typecheck/test: 16 tác vụ đạt; lint không lỗi, còn warning trong repo.
- Core unit: 2.816 đạt, 4 skipped theo cấu hình/bộ test; thêm 2 test payload legacy/đích chính xác đạt sau lượt chạy toàn bộ.
- Notification unit: 138 đạt; Notification integration: 11 đạt.
- Moderation integration: 50 đạt.
- Toàn bộ content integration: 128/128 đạt, 16 file, chạy với `--maxWorkers=2`. Lượt chạy mặc định trước đó gặp timeout kết nối khi nhiều database test khởi tạo đồng thời; không sửa code/timeout test để bỏ qua lỗi, chạy lại giới hạn worker và đạt toàn bộ.
- `contracts:build`, áp migration local, ranh giới module, `git diff --check`: đạt.
- Live Edge + Web/API/Notification thật: 11 nhóm kiểm tra đạt; ảnh/kết quả tại workspace `outputs/tf92-acceptance`.

## Triển khai

1. Chạy migration content `20261118090317_eager_stature` trước Core mới. Không xóa dữ liệu/cột cũ.
2. Cập nhật Notification nhận `replyRecipientKnown`, rồi Core phát event mới và FE dùng DTO mới.
3. Kiểm tra hàng chờ bài có bộ lọc và reply sau duyệt. Local đã áp migration và chạy Core/Notification mới.

Không sửa thông báo lịch sử. Trả lời cũ không có đích chính xác có thể thiếu thông báo trả lời trực tiếp khi nhả held; chọn không suy đoán để tránh báo sai người. Không có nghiệm thu native trong phiên này theo xác nhận của người dùng.
