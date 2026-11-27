# TF28 — Dừng khẩn cấp job discovery, tính điểm bài trong worker_thread

- Notion: TF28 · Nhánh: `duy/TF28-dung-khan-cap-job` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-27

## Đã làm

Hiện tại, nếu một lượt job discovery đang ghi dữ liệu sai thì admin không làm gì được. Phải chờ lượt đó chạy xong, rồi 10 phút sau job lại tự chạy. Trong lúc chờ cũng không dừng được giữa chừng, vì có hai lý do:

1. Job chạy trong process worker, không phải process trả lời trang admin. Đây có thể là một máy khác.
2. Node không ngắt được một hàm đang chạy. `post_profile@v1` tính khoảng 3,3 giây liền trên 41k bài, ngay trên event loop. Với `APP_ROLE=all`, mọi API phải đứng chờ trong lúc đó.

### Post builder chạy trong worker_thread

- Builder là code thuần, chỉ import `zod` và hàm domain. Vì vậy chỉ chuyển phần tính điểm và kiểm `featuresSchema` sang một `worker_thread` cho mỗi lượt. Đọc và ghi DB vẫn ở luồng chính.
- Mỗi lượt chép bài sang thread một lần. Các builder chỉ được gọi theo khoá và đọc từ `BUILDERS` trong thread.
- Các file:
  - `PostBuildRunner` (port);
  - `ThreadPostBuildRunner` (prod);
  - `InProcessPostBuildRunner` (test, vì vitest không nạp được file worker `.ts`);
  - `post-build.worker.ts` (entry của thread).
- Đo chi phí chép dữ liệu (`tools/discovery-load/clone-cost.mjs`, 41.314 bài):
  - items là 26 MB; serialize hoặc gửi mất khoảng 85–100 ms;
  - kết quả trả về là 9–13 MB;
  - `post_profile@v1` tính trong 3.288 ms.

### Dừng khẩn cấp

- `POST /api/v1/admin/discovery/jobs/:job/stop`, body `{ "reason": "…" }` (3–300 ký tự), chỉ superadmin:
  1. Đặt tạm dừng: khoá Redis `discovery:job-paused:<job>`, không hết hạn, ghi ai dừng, lúc nào, vì sao.
  2. Báo mọi lượt đang chạy của job dừng lại: khoá `discovery:job-cancel:<runId>`.
- `JobRuns.track` kiểm lệnh dừng mỗi 2 giây rồi huỷ `AbortSignal` của lượt. Lượt đó ghi outcome mới `cancelled`, kèm lý do.
- Mỗi job dừng ở một chỗ an toàn:

  | Job | Chỗ dừng | Dữ liệu |
  |---|---|---|
  | `recommend_build` | `terminate()` worker ngay giữa lúc tính; trước mỗi bước ghi; giữa các lô 200 người | Builder chưa ghi thì giữ dữ liệu cũ. Lô người dùng đã ghi thì giữ nguyên. |
  | `explore` (Typesense) | Trước khi nạp và trước khi đổi alias | Xoá collection đang dựng dở, alias vẫn trỏ chỉ mục cũ. |
  | `explore` (Postgres) | Giữa các lô insert | Transaction rollback. |
  | `recommend_purge` | Giữa các lô xoá 5.000 dòng | Lô đã xoá không lấy lại được (dữ liệu đã hết hạn). |
  | `suggest` | Không có (chạy dưới 1 giây) | — |

- Khi đang tạm dừng:
  - lượt theo lịch bỏ qua và không ghi lịch sử;
  - Chạy ngay trả `{ accepted: false, reason: "paused" }`.
- `POST …/:job/resume` bỏ tạm dừng.
- `GET` có thêm trường `pause` cho mỗi job.
- API chỉ thêm, không đổi cái cũ. `contracts/` được sinh lại.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Admin dừng được lượt đang chạy, kể cả khi job chạy ở process khác | ✅ | `job-runs.spec.ts` › "lệnh dừng từ process khác…"; bench: dừng sau 2,0 s, outcome `cancelled` |
| Dừng xong job không tự chạy lại | ✅ | `job-runs.spec.ts` › "đang tạm dừng…"; bench: chạy tay trả `paused` |
| Dừng không để chỉ mục hay điểm dở dang | ✅ | `typesense-explore.store.spec.ts` › "dừng khẩn cấp trong lúc nạp"; `build-features.use-cases.spec.ts` › "dừng khẩn cấp"; `purge-interactions.job.spec.ts` |
| API không bị treo khi job build chạy | ✅ | Bench `/health` mỗi 50 ms, xem bảng dưới |
| Chỉ superadmin, phải có lý do | ✅ | `admin-discovery-jobs.controller.spec.ts` › "dừng khẩn cấp", "quyền" |

**Đo trên bench local.** Máy giả lập VM staging, core-api cùng DB ghim 4 lõi, 41.314 bài, 1.167 người. Chạy tay `recommend_build` và gọi `/health` mỗi 50 ms (`tools/discovery-load/stop-check.mjs lag`):

| Image | Lượt | `/health` p50 | max (event loop treo) |
|---|---|---|---|
| `develop` | 2 | 5 ms | 2.661 ms, 2.536 ms |
| Nhánh này | 3 | 4 ms | 315 ms, 383 ms, 355 ms |

Kiểm dừng khẩn cấp (`stop-check.mjs stop`): bấm dừng sau 4 giây, lúc `hot@v2` đã ghi xong và `post_profile@v1` đang tính.
- Lượt dừng hẳn sau 2.027 ms, ghi `cancelled` với lý do "Dừng khẩn cấp: Kiểm dừng khẩn cấp (bench)".
- Chạy tay sau đó bị từ chối (`paused`).
- `resume` trả 204, `pause` về `null`.

## Kết quả kiểm tra

- `pnpm turbo run lint typecheck test --affected --concurrency=2`:
  - lint và typecheck pass. Lint chỉ có warning có sẵn, ví dụ `job-runs.ts:179` từ trước.
  - Test lỗi 7 test e2e của content/access vì timeout, do máy bận chạy container bench. Chạy riêng thì pass.
- `pnpm --filter @tripflix/core-api test` (sau khi merge develop có #345, #346): 211 file pass, 2 skipped; 3.323 test pass, 4 skipped.

## Cách kiểm lại

1. `pnpm stack:up`, đăng nhập superadmin.
2. `POST /api/v1/admin/discovery/jobs/recommend_build/run`. Trong vài giây, gọi `POST …/recommend_build/stop` với body `{"reason":"thử dừng"}`.
3. `GET …/jobs?group=recommend`:
   - lượt mới nhất là `cancelled`, kèm lý do;
   - `pause` có ai dừng và lý do;
   - Chạy ngay trả `paused`.
4. `POST …/recommend_build/resume`.

## Ảnh / video

- Giao diện ở PR FE riêng.

## Ảnh hưởng tới phần của người khác

- Không sửa code của người khác. Chỉ sửa trong `discovery` và sinh lại `contracts/`.
- Lần đầu repo dùng `worker_threads`. Không phải sửa Dockerfile, vì `nest build` đã đưa `post-build.worker.js` vào `dist`. Báo Dũng (backup `libs`/cấu hình) và Tech Lead để biết kiểu viết mới này.
