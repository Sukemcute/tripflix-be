# TF94 — Cập nhật tài liệu kiến trúc BE

- Jira: [SCRUM-121](https://tripflix.atlassian.net/browse/SCRUM-121)
- Người làm: Trang (dùng AI: có), ngày 2026-11-16.

## Đã làm
- README và docs/architecture/10, 11 mô tả worker Go chạy trên staging, worker Node dùng ở dev.
- Cập nhật notification: Nodemailer, Redis Streams, dead-letter; BullMQ/push còn là kế hoạch.
- Ghi rõ job định kỳ chạy trong core-api theo APP_ROLE và hai worker dùng chung consumer group.

## Kiểm tra
- Đối chiếu deploy/compose.server.yaml (image video-worker-go), libs/event-bus/src/consumer.ts (maxDeliveries mặc định 5), notification-service/src/consumers/dead-letter-replay.ts (8 lần, 5 phút nhân 2 mũ số lần thử).
- git diff --check đạt. Chỉ thay Markdown; không có thay đổi mã chạy. CI sẽ chạy kiểm tra của repo.

## Xong khi
- Nội dung hiện trạng được đối chiếu với code; cần Dũng/Tech Lead review tài liệu chung và Phong review phần video.

## Ảnh hưởng
- README chung và tài liệu kiến trúc: Dũng/Tech Lead. Worker: Phong. Nhánh tách riêng từ develop, giữ nguyên nội dung bốn file người dùng đã soạn.