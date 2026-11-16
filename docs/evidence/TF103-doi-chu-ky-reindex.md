# TF103 — Admin đổi chu kỳ job dựng lại chỉ mục tìm kiếm

- Jira: SCRUM-127 · Nhánh: `duy/TF103-doi-chu-ky-reindex` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Chu kỳ job `explore` lưu ở Redis `discovery:job-interval:explore` (`JobRuns.getIntervalMs` / `setIntervalMs`). Chưa đặt, giá trị hỏng hay Redis lỗi thì dùng mặc định 10 phút.
- `RebuildExploreIndexJob` thay `setInterval` 10 phút bằng nhịp 1 phút: mỗi nhịp đọc chu kỳ, đủ thời gian kể từ lượt trước thì chạy. Đổi chu kỳ có hiệu lực trong vòng 1 phút, không cần khởi động lại. Chạy tay tính là một lượt.
- `PUT /api/v1/admin/discovery/jobs/:job/interval` (superadmin), body `{ intervalMs }` 1 phút–24 giờ, `null` = mặc định; chỉ `explore` đổi được.
- `GET /api/v1/admin/discovery/jobs` thêm `defaultIntervalMs`, `canChangeInterval`; `intervalMs` là chu kỳ đang dùng.
- Theo dõi worker (`index-health`) tính `stuck`/`overdue` theo chu kỳ job ghi lúc bắt đầu.
- FE (nút trên trang admin): Thành làm, đã có mô tả API.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đổi chu kỳ qua API thì lượt sau theo chu kỳ mới, không khởi động lại | Có (test) | `rebuild-explore-index.job.spec.ts` (fake timer: rút 10 → 3 phút, nới ra 1 giờ) |
| `GET /jobs` hiện đúng chu kỳ | Có (test) | `admin-discovery-jobs.controller.spec.ts` mục TF103 |
| Redis lỗi về mặc định; endpoint kiểm giới hạn và quyền | Có | `job-runs.spec.ts`, `admin-discovery-jobs.controller.spec.ts` |
| Trạng thái quá hạn theo chu kỳ mới | Có | `index-health.spec.ts` |
| `pnpm contracts:build`; lint, typecheck, test pass | Có | Xem dưới |

## Kết quả kiểm tra
- `pnpm turbo run lint typecheck test --affected --continue --concurrency=2`: pass (exit 0). core-api 2553 test pass, 4 skip; lint 0 lỗi (112 cảnh báo có sẵn).
- `contracts/openapi/core-api.json`: thêm endpoint và 2 trường; mô tả `intervalMs` đổi chữ.
- Chưa chạy thử trên stack thật (Docker Desktop không chạy lúc làm).

## Cách kiểm lại
1. `pnpm stack:be`, đăng nhập superadmin seed.
2. `PUT /api/v1/admin/discovery/jobs/explore/interval` body `{ "intervalMs": 120000 }`.
3. Xem log core-api: "Đã dựng chỉ mục tìm khám phá" cách nhau ~2 phút; `GET /api/v1/admin/discovery/jobs?group=search` trả `intervalMs: 120000`.
4. `{ "intervalMs": null }` để về 10 phút.

## Ảnh / video
- Không đổi giao diện (nút do Thành làm).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `discovery` (Duy). Màn admin `discovery-jobs` của Thành vẫn chạy với `intervalMs` như cũ.
