# TF28 — Lượt job discovery bị ngắt giữa chừng không còn kẹt "Đang chạy"

- Notion: TF28 · Nhánh: `duy/TF28-job-run-bi-ngat` · Người làm: Duy (dùng AI: có) · Ngày: 2026-11-19

## Bug

Staging deploy PR #277 lúc lượt `recommend_build` 10:57:31 đang chạy: container core-api bị thay, trang lịch sử job trên admin hiện lượt đó "Đang chạy" mãi. Job thật không kẹt (khoá advisory Postgres tự nhả, lượt 10:58:24 và 11:07:04 đều thành công); chỉ bản ghi lịch sử trong Redis bị bỏ dở, vì `JobRuns.track` ghi `running` rồi mới chạy thân job và ghi kết quả.

## Đã làm

- `jobs/job-runs.ts`: mỗi lượt giữ khoá sống `discovery:job-run-alive:<runId>` (TTL 2 phút, làm mới mỗi 30 giây, dừng trong `finally`). `list()` gặp lượt `running` mà hết khoá sống thì ghi lại thành `failed`, lỗi "Bị ngắt: tiến trình dừng giữa chừng (deploy/restart)", `finishedAt` = lúc phát hiện.
- Không dọn lúc khởi động: core-api tách được api/worker và scale nhiều bản, chạy tay chạy trên bản nhận request, dọn lúc boot sẽ đè lượt của bản khác còn sống.
- Dùng outcome `failed` sẵn có, không đổi `JobRun` hay API: admin (FE) không phải sửa.
- Lỡ coi nhầm là chết (event loop/Redis nghẽn quá 2 phút): khi lượt đó chạy xong, `finish()` ghi đè lại kết quả thật.

## Đối chiếu "Xong khi"

| Tiêu chí | Đạt | Bằng chứng |
|---|---|---|
| Lượt bị ngắt không còn hiện "Đang chạy" | Có | `job-runs.spec.ts` › "lượt running của tiến trình đã chết (hết khoá sống) thành failed; lượt còn sống giữ nguyên" |
| Lượt đang chạy thật không bị đánh dấu sai | Có | cùng test trên (lượt `live`) và test "ghi running khi đang chạy rồi ghi kết quả" |
| Không thêm outcome mới | Có | `JOB_OUTCOMES` giữ nguyên |

## Kết quả kiểm tra

`pnpm turbo run lint typecheck test --filter=@tripflix/core-api`: 13/13 task thành công; 168 file test pass, 2 skip; 2931 test pass, 4 skip, 0 fail.

## Cách kiểm lại

1. `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/jobs`.
2. Trên staging sau deploy: mở trang job discovery của admin, lượt 10:57:31 của `recommend_build` hiện "Thất bại" với lý do bị ngắt.

## Ảnh / video

- Không đổi giao diện.

## Ảnh hưởng tới phần của người khác

- Không. Chỉ sửa `modules/discovery/jobs/` (Duy).
