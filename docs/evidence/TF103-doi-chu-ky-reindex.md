# TF103 — Admin đổi chu kỳ job dựng lại chỉ mục tìm kiếm và job tính đặc trưng gợi ý

- Jira: SCRUM-127 · Nhánh: `duy/TF103-doi-chu-ky-reindex` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-16

## Đã làm
- Chu kỳ job `explore` và `recommend_build` lưu ở Redis `discovery:job-interval:{job}` (`JobRuns.getIntervalMs` / `setIntervalMs`). Chưa đặt, giá trị hỏng hay Redis lỗi thì dùng mặc định 10 phút.
- `RebuildExploreIndexJob` và `BuildFeaturesJob` thay `setInterval` 10 phút bằng nhịp 1 phút (`SCHEDULE_TICK_MS` trong `job-runs.ts`): mỗi nhịp đọc chu kỳ, đủ thời gian kể từ lượt trước thì chạy. Đổi chu kỳ có hiệu lực trong vòng 1 phút, không cần khởi động lại. Chạy tay tính là một lượt.
- `PUT /api/v1/admin/discovery/jobs/:job/interval` (superadmin), body `{ intervalMs }` 1 phút–24 giờ, `null` = mặc định; đổi được `explore` và `recommend_build` (`suggest`, `recommend_purge` trả 400).
- `GET /api/v1/admin/discovery/jobs` thêm `defaultIntervalMs`, `canChangeInterval`; `intervalMs` là chu kỳ đang dùng.
- Theo dõi worker (`index-health`) tính `stuck`/`overdue` của `explore` theo chu kỳ job ghi lúc bắt đầu.
- `recommend_build` dài hơn thì gợi ý cập nhật chậm hơn (đặc trưng bài/người dùng cũ hơn); ngắn hơn thì tốn DB hơn.
- FE (nút trên trang admin): Thành làm, đã có mô tả API.

## Đối chiếu "Xong khi"
| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Đổi chu kỳ qua API thì lượt sau theo chu kỳ mới, không khởi động lại | Có (test + chạy thật) | `rebuild-explore-index.job.spec.ts` (fake timer: rút 10 → 3 phút, nới ra 1 giờ), `build-features.job.spec.ts` (10 → 30 phút) |
| `GET /jobs` hiện đúng chu kỳ | Có (test) | `admin-discovery-jobs.controller.spec.ts` mục TF103 |
| Redis lỗi về mặc định; endpoint kiểm giới hạn và quyền | Có | `job-runs.spec.ts`, `admin-discovery-jobs.controller.spec.ts` |
| Trạng thái quá hạn theo chu kỳ mới | Có | `index-health.spec.ts` |
| `pnpm contracts:build`; lint, typecheck, test pass | Có | Xem dưới |

## Kết quả kiểm tra
- Sau khi merge `origin/develop` mới nhất: `pnpm turbo run lint typecheck test --affected --continue --concurrency=2` pass (exit 0, 49/49 task). core-api 2562 test pass, 4 skip; lint 0 lỗi (112 cảnh báo có sẵn).
  - Chạy cùng lúc với stack Docker thì vài test e2e quá 5 giây (đã biết, không liên quan); tắt stack chạy lại thì pass.
- `contracts/openapi/core-api.json`: thêm endpoint và 2 trường; mô tả `intervalMs` đổi chữ.
- Chạy thử trên stack thật (`pnpm stack:be`, superadmin seed, Node fetch):
  - `PUT …/jobs/recommend_build/interval` và `…/explore/interval` với 120000: 200; `GET /jobs` hiện `intervalMs: 120000`, `defaultIntervalMs: 600000`.
  - `suggest`, `recommend_purge`: 400 "Chỉ đổi được: explore, recommend_build"; job lạ 404; 30000 ms: 400; moderator 403; không token 401.
  - Lần chạy đầu bắt được lỗi: job chạy mỗi **3** phút thay vì 2 (13:22:35 → 13:25:33 → 13:28:33). Lượt trước ghi giờ bắt đầu trễ vài ms sau nhịp (chờ đọc Redis) nên so `>=` đúng chu kỳ thì trượt thêm một nhịp; mặc định 10 phút thực chất là 11. Sửa bằng `isDue` chừa nửa nhịp (`job-runs.ts`, test `job-runs.spec.ts` fail trước khi sửa).
  - Sau khi sửa: cả hai job chạy 13:37:30 → 13:39:28 → 13:41:28, đúng 2 phút, không khởi động lại. Đặt lại `null` thì về 600000.

## Cách kiểm lại
1. `pnpm stack:be`, đăng nhập superadmin seed.
2. `PUT /api/v1/admin/discovery/jobs/explore/interval` body `{ "intervalMs": 120000 }`.
3. Xem log core-api: "Đã dựng chỉ mục tìm khám phá" cách nhau ~2 phút; `GET /api/v1/admin/discovery/jobs?group=search` trả `intervalMs: 120000`.
4. `{ "intervalMs": null }` để về 10 phút.
5. Tương tự với `PUT …/jobs/recommend_build/interval`; xem `GET …/jobs?group=recommend`.

## Ảnh / video
- Không đổi giao diện (nút do Thành làm).

## Ảnh hưởng tới phần của người khác
- Không. Chỉ sửa trong `discovery` (Duy). Màn admin `discovery-jobs` của Thành vẫn chạy với `intervalMs` như cũ.
