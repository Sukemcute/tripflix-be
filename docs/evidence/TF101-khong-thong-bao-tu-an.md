# TF101 phần 3 — Không gửi thông báo khi hệ thống tự ẩn bình luận

- Jira: [SCRUM-125](https://tripflix.atlassian.net/browse/SCRUM-125)
- Nhánh: `trang/TF101-khong-thong-bao-tu-an` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-17

## Đã làm
- Handler content.moderation.decided.v1 trả thành công ngay khi targetType comment, isAutomatic true và action hide.
- Không tạo inbox, không đọc số chưa đọc và không phát notification.created trong trường hợp tự ẩn.
- Giữ thông báo khi staff ẩn/gỡ, khi khôi phục và khi có kết quả khiếu nại. Không sửa luồng post.comments.changed, API hay schema.

## Đối chiếu tiêu chí
| Tiêu chí | Bằng chứng |
|---|---|
| Tự ẩn không gửi thông báo và sự kiện vẫn được xử lý thành công | content-status.spec.ts: không insert/countUnread/emitToUser, handled true |
| Staff hide/remove và restore vẫn gửi inbox | content-status.spec.ts: bảng action và isAutomatic |
| Quyết định trực tiếp và kết quả khiếu nại vẫn gửi | Hai test hiện có trong content-status.spec.ts |

## Kết quả kiểm tra
- Spec content-status: 8/8 test đạt.
- `pnpm turbo run lint typecheck test --affected`: 49/49 task đạt; core-api 2691 test đạt, 4 skipped có sẵn.
- Kiểm tra diff cuối riêng notification-service: lint/typecheck/test 10/10 task đạt, 133/133 test đạt.

## Cách kiểm lại
1. `pnpm --filter @tripflix/notification-service test -- src/consumers/handlers/content-status.spec.ts`
2. `pnpm turbo run lint typecheck test --affected`

## Ảnh / video
- Thay đổi BE, không đổi giao diện.

## Ảnh hưởng tới phần của người khác
- notification-service của Dũng; Dũng duyệt theo phân công TF101. PR độc lập với TF101 phần 2.
