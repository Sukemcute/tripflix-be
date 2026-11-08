# TF14 — Ẩn cảnh báo an toàn "nghe nói" khỏi GET tóm tắt công khai

- Jira: [SCRUM-18](https://tripflix.atlassian.net/browse/SCRUM-18) · Nhánh: `trang/TF14-an-canh-bao-cho-duyet` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-08

## Đã làm
- `GetPostSummaryUseCase`: người xem không phải moderator/superadmin nhận `safety` đã bỏ `pendingWarnings`; staff vẫn thấy đủ để duyệt.
- Lý do: ai-service gửi cảnh báo dạng "nghe nói" (không phải người tự trải nghiệm) trong `safety.pendingWarnings` của `PUT ai-summary`; cảnh báo chưa duyệt không được lộ ra người dùng.
- Chưa làm: hàng chờ duyệt và thao tác duyệt (chuyển `pendingWarnings` sang `warnings`) ở trang admin.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| GET công khai không trả `safety.pendingWarnings` | Có | e2e `GET công khai không trả safety.pendingWarnings` |
| Khách, thành viên chỉ thấy `warnings`; moderator thấy đủ | Có | unit `ẩn safety.pendingWarnings với người xem thường, moderator vẫn thấy` |

## Kết quả kiểm tra
- `pnpm typecheck` (core-api): sạch.
- `pnpm lint` (core-api): 0 lỗi; không có cảnh báo mới ở dòng đã sửa.
- `pnpm test` (core-api): 59 file, 652 test pass, 1 skip.

## Cách kiểm lại
1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/content/social`
2. PUT `/api/v1/posts/:id/ai-summary` bằng token ai-service với `safety.pendingWarnings`, rồi GET không token: `safety` chỉ còn `warnings`.

## Ảnh hưởng tới phần của người khác
- Sửa `get-post-summary.use-case.ts` và spec của Thành (module content/social): chỉ thêm bước lọc, không đổi chữ ký hay hợp đồng API.
- Mở khoá cho nhánh `bao/TF14-canh-bao-cho-duyet` (AI) merge.
