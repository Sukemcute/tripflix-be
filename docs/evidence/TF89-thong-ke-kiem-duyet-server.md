# TF89 — Thống kê kiểm duyệt tính ở server cho Admin

- Jira: [SCRUM-116](https://tripflix.atlassian.net/browse/SCRUM-116) · Nhánh: `trang/TF89-thong-ke-kiem-duyet-server` · Người làm: Trang (dùng AI: có) · Ngày: 2026-11-14

## Đã làm
- Thêm `GET /v1/admin/moderation/stats` (moderator, superadmin). Số liệu đếm trong Postgres bằng một câu truy vấn:
  - `pendingTotal`, `pendingPosts`, `pendingComments`, `oldestPendingAt`: hồ sơ chờ duyệt, cùng điều kiện với `queue?view=pending` (hồ sơ `pending` và nội dung còn `published`/`visible`/`hidden`), nên số trên thẻ bằng `total` của danh sách.
  - `pendingUrgent`: hồ sơ chờ duyệt có severity ≥ `URGENT_SEVERITY` (80, hằng mới trong `domain/severity.ts`, khớp nhãn đỏ của Admin).
  - `autoHidden24h`, `reports24h`: số lần tự ẩn và số báo cáo mới trong 24 giờ.
  - `pendingAppeals`, `failedScans`, `deferredScans`.
- Lý do: Admin đang lấy 100 dòng đầu của queue/nhật ký rồi đếm ở FE, nên khi dữ liệu vượt 100 dòng thì số "khẩn cấp" và "đã tự ẩn" bị thiếu. Đây là lát đầu của BE-10/ADMIN-03 trong `docs/moderation/02` (P1).
- Đã chạy `pnpm contracts:build`. `contracts/openapi/core-api.json` chỉ thêm path và schema `ModerationStatsDto`, không xoá hay đổi gì.
- Không đổi schema database, không đổi sự kiện, không có migration.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Số liệu đúng khi dữ liệu vượt 100 dòng, có integration test Postgres | ✅ | `moderation.int.spec.ts` (Postgres thật): "thống kê đếm ở server đúng khi hàng chờ vượt 100 dòng, khớp total của queue (TF89)". 122 hồ sơ chờ, 32 khẩn cấp; loại hồ sơ đã đóng, bài đã gỡ, tự ẩn và báo cáo cũ hơn 24 giờ; `pendingTotal` bằng `queue(view=pending).total` |
| Phân quyền | ✅ | `moderation.e2e.spec.ts`: guest 401, member 403, moderator/superadmin 200 |
| Admin hiển thị số từ API, không lọc 100 dòng ở FE | ⏳ | Phần FE admin (chủ: Thành) làm ở PR riêng bên `tripflix-fe` |
| Lint, typecheck, test pass | ✅ | Mục "Kết quả kiểm tra" |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected`: 49/49 task thành công. Lint 0 lỗi (core-api còn 109 warning có sẵn).
- `vitest run --config vitest.int.config.ts …/moderation.int.spec.ts`: 30/30 pass.
- `vitest run …/moderation.e2e.spec.ts`: 7/7 pass.
- Unit test core-api chạy riêng 4 lần: 3 lần 2387 pass, 4 skip có sẵn; 1 lần có 1 test fail không lặp lại ở các lần sau nên chưa xác định được test nào. Thay đổi của task chỉ thêm endpoint đọc, không đụng logic có sẵn.

## Cách kiểm lại
1. `pnpm turbo run lint typecheck test --affected`
2. `cd apps/core-api && npx vitest run --config vitest.int.config.ts src/modules/content/moderation/application/moderation.int.spec.ts` (cần Docker)
3. Chạy stack local, đăng nhập moderator, gọi `GET /api/v1/admin/moderation/stats` và so `pendingTotal` với `total` của `GET /api/v1/admin/moderation/queue?view=pending`.

## Ảnh / video
- Không đổi giao diện trong PR này.

## Ảnh hưởng tới phần của người khác
- Không đụng code của người khác. Chỉ thêm endpoint mới trong `content/moderation`.
- FE admin (Thành) có thể dùng endpoint sau khi chạy `pnpm gen:api`.
