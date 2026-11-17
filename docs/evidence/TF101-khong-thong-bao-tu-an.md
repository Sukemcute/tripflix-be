# TF101 phần 3 — Không gửi thông báo khi hệ thống tự ẩn bình luận

- Jira: [SCRUM-125](https://tripflix.atlassian.net/browse/SCRUM-125)
- Nhánh: `trang/TF101-khong-bao-khoi-phuc-tu-an` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-18

## Đã làm
- Handler `content.moderation.decided.v1` trả thành công ngay khi targetType comment, isAutomatic true và action hide.
- Khôi phục bình luận từng bị tự ẩn cũng không tạo inbox hay phát notification. Core đọc `hiddenByActionId` của bình luận và action record được trỏ tới, gửi cờ tùy chọn `previouslyAutoHidden` trong event moderation trực tiếp hoặc moderation case; notification-service bỏ qua riêng thông báo restore có cờ này.
- Không tạo inbox, không đọc số chưa đọc và không phát notification.created trong trường hợp tự ẩn.
- Giữ thông báo khi staff ẩn/gỡ, khi khôi phục sau thao tác ẩn thủ công, và khi có kết quả khiếu nại.
- Event metadata được mở rộng tương thích ngược bằng trường tùy chọn; không sửa luồng `post.comments.changed` hay API.

## Đối chiếu tiêu chí
| Tiêu chí | Bằng chứng |
|---|---|
| Tự ẩn không gửi thông báo và sự kiện vẫn được xử lý thành công | content-status.spec.ts: không insert/countUnread/emitToUser, handled true |
| Staff hide/remove và restore không bắt nguồn từ auto-hide vẫn gửi inbox | content-status.spec.ts: bảng action và isAutomatic; event thiếu `previouslyAutoHidden` giữ hành vi cũ |
| Restore sau auto-hide không tạo inbox hay notification | Core moderation integration: gắn cờ cho cả event trực tiếp và moderation case; content-status.spec.ts: bỏ qua cả hai event path |
| Quyết định trực tiếp và kết quả khiếu nại vẫn gửi | Hai test hiện có trong content-status.spec.ts |

## Kết quả kiểm tra
- `pnpm contracts:build`: thành công.
- `pnpm --filter @tripflix/contracts test`: 23/23 test đạt.
- Notification handler: 10/10 test đạt; contracts 23/23 test đạt.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task đạt; core-api 2772 test đạt, 4 skipped có sẵn.
- `pnpm test:int` trên CI pass với thay đổi cuối, xác nhận integration trên Postgres/Testcontainers. Lượt chạy local bị chặn vì ổ C còn dưới 1 MB và Docker không phản hồi; CI đã xác nhận thay thế.

## Cách kiểm lại
1. `pnpm --filter @tripflix/notification-service test -- src/consumers/handlers/content-status.spec.ts`
2. `pnpm --filter @tripflix/core-api test:int -- src/modules/content/moderation/application/moderation.int.spec.ts` (cần Docker/Testcontainers hoạt động)
3. `pnpm turbo run lint typecheck test --affected`

## Ảnh / video
- Thay đổi BE, không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- notification-service của Dũng; Dũng duyệt theo phân công TF101. PR độc lập với TF101 phần 2.
