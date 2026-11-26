# TF99 — Đo tải bình luận theo số người dùng: load, stress, spike, scale (local và staging)

- Jira: TF99 · Nhánh: `thanh/TF99-do-tai-theo-vus` · Người làm: Lê Quang Thành (dùng AI: có) · Ngày: 2026-11-24
- Kế hoạch: báo cáo "Bình luận chịu tải và realtime", mục "Đo theo số VU (24/11)".

## Đã làm
- `tools/bench/comments/k6/levels.js`: mỗi lượt k6 là một mức VU, mỗi VU nghỉ 1–3 s giữa hai thao tác như người thật; khởi động 10 s (không tính), đo 60 s. Ba kiểu: `read` (trang 1, 50, cuối), `write` (20% là trả lời), `mixed` (80% đọc, 15% gửi, 5% mở trả lời). Sau lượt có ghi, đi lại hết trang để bắt thiếu, lặp.
- `run.sh vus`: chạy 3 kiểu × 5 mức × `RUNS` lần, seed lại trước mỗi lượt, lấy mẫu CPU core-api (Windows, theo cổng) và container Postgres mỗi giây, sau lượt có ghi so `comment_count` với số bình luận thật. `RUN_INDEX` chạy lại một lần cụ thể mà không xoá các lần khác.
- `summarize.mjs`: bảng theo VU (request/giây, p50, p95, p99, p95 tách đọc, gửi, trả lời, lỗi, CPU, chờ khoá, số đếm và phân trang, đạt ngưỡng).
- Không đổi code ứng dụng.

## Điều kiện đo
- Develop `8cafa1e` (đã có #208, #212, #235, #236, #243, #200). Laptop i7-11850H; core-api `node dist/main.js`, `LOG_LEVEL=info`, `APP_ROLE=all` (như `deploy/compose.server.yaml`); Postgres, Redis trong Docker; k6 `grafana/k6:2.4.0` trong Docker.
- Ngưỡng: đọc và mở trả lời p95 < 150 ms, gửi p95 < 300 ms, lỗi < 1%.
- Không so thẳng với `TF99-benchmark-binh-luan.md` (16/11): lần đó VU không nghỉ để tìm trần, lần này đo theo người dùng thật.

## Kết quả (trung vị 3 lần, phần đo 60 s)
| Kiểu | VU | Request/giây | p50 | p95 (thấp–cao) | p99 | Lỗi | CPU core-api (% 1 nhân) | Chờ khoá | Đạt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Đọc | 5 | 3 | 7,3 ms | 9,5 (9–12) | 12 ms | 0% | 15 | 0% | 3/3 |
| Đọc | 25 | 13 | 6,7 ms | 9,8 (10–10) | 40 ms | 0% | 9 | 0% | 3/3 |
| Đọc | 50 | 25 | 6,6 ms | 9,9 (10–10) | 70 ms | 0% | 12 | 0% | 3/3 |
| Đọc | 100 | 51 | 6,3 ms | 9,8 (10–10) | 162 ms | 0% | 19 | 0% | 3/3 |
| Đọc | 200 | 101 | 6,0 ms | 10,2 (10–10) | 342 ms | 0% | 31 | 0% | 3/3 |
| Hỗn hợp | 5 | 3 | 7,2 ms | 20,1 (19–21) | 22 ms | 0% | 13 | 0% | 3/3 |
| Hỗn hợp | 25 | 13 | 7,0 ms | 20,0 (20–20) | 40 ms | 0% | 12 | 0% | 3/3 |
| Hỗn hợp | 50 | 25 | 6,5 ms | 19,0 (19–19) | 82 ms | 0% | 16 | 0% | 3/3 |
| Hỗn hợp | 100 | 51 | 6,5 ms | 18,4 (18–19) | 154 ms | 0,17%* | 28 | 2% | 3/3 |
| Hỗn hợp | 200 | 101 | 6,4 ms | 18,3 (18–19) | 332 ms | 0,21%* | 44 | 3% | 3/3 |
| Gửi | 5 | 3 | 17,5 ms | 21,1 (21–21) | 26 ms | 0% | 12 | 0% | 3/3 |
| Gửi | 25 | 13 | 11,4 ms | 20,2 (20–20) | 58 ms | 0% | 17 | 6% | 3/3 |
| Gửi | 50 | 25 | 10,6 ms | 20,1 (19–20) | 118 ms | 0% | 33 | 7% | 3/3 |
| Gửi | 100 | 50 | 11,3 ms | 22,7 (22–25) | 227 ms | 0% | 57 | 13% | 3/3 |
| Gửi | 200 | 100 | 14,8 ms | 38,7 (37–60) | 501 ms | 0% | 82 | 21% | 3/3 |

- Sau 30/30 lượt có ghi: `comment_count` khớp số bình luận thật, bảng đệm đã cộng hết; đi hết trang không thiếu, không lặp.
- \* Lỗi của 2 dòng này là một lượt chạm rìa khung job nền ở dưới (toàn bộ lỗi 500 trong log core-api đều rơi vào khung job).

## Phát hiện ngoài phần bình luận
- 6/45 lượt đầu có p95 10–36 s, 440 lỗi 500 `timeout exceeded when trying to connect`, đều trùng lúc `BuildFeaturesJob` (discovery) chạy mỗi 10 phút: `Builder trip_profile@v1` tính 14–27 s liền trên luồng chính của Node nên mọi request phải chờ. Thời gian job tăng dần trong buổi đo (23,6 s → 44,7 s), chưa kiểm vì sao.
- 6 lượt đó đã chạy lại ngoài khung job (`RUN_INDEX`), bản gốc giữ ở `out/stalled/` (không commit).
- Cần báo Duy (chủ discovery): `compose.server.yaml` cũng để `APP_ROLE=all` nên staging nhiều khả năng khựng y như vậy.

## Kết quả kiểm tra
- Chạy thật: `RUNS=1 VUS_LEVELS=5 bash tools/bench/comments/run.sh vus` (chạy thử), `bash tools/bench/comments/run.sh vus` (45 lượt), chạy lại 6 lượt bằng `RUN_INDEX`.
- `bash -n run.sh`, `node --check summarize.mjs`: hợp lệ.
- Không đổi code ứng dụng nên không ảnh hưởng lint, typecheck, test của core-api.

## Cách kiểm lại
1. Làm theo `tools/bench/comments/README.md` (5 tài khoản bench), bật core-api bản build.
2. `bash tools/bench/comments/run.sh vus` (khoảng 80 phút) rồi `cat tools/bench/comments/out/summary.md`.
3. Lượt nào trùng job nền (xem log core-api có `Đã tính đặc trưng gợi ý`) thì chạy lại: `KINDS=write VUS_LEVELS=200 RUN_INDEX=1 bash tools/bench/comments/run.sh vus`.
4. Xong thì `bash tools/bench/comments/run.sh cleanup`.

## Ảnh / video
- Không đổi giao diện. Báo cáo đầy đủ (biểu đồ, sơ đồ nút thắt, so sánh A/B, staging) ở artifact "Bình luận chịu được bao nhiêu, và nghẽn ở đâu".

## Ảnh hưởng tới phần của người khác
- Không sửa code của ai. Đã báo Duy về `BuildFeaturesJob` (gom dòng O(N²), chặn API) và `fresh` cho gợi ý bài viết; Duy đã sửa trên develop (`3ae1613`, `7782977`, `a0460af`).
- Đo staging có anh Phong hỗ trợ (VM k6, đổi cấu hình, lấy mẫu CPU, dọn dữ liệu bằng `cleanup-bench-users.sql`).

## Mở rộng tới 1000 VU (24/11, 17:09–19:31)

- 3 kiểu × 9 mức (5 25 50 100 200 300 500 750 1000) × 3 lần, job gợi ý tạm giãn 6 giờ qua `discovery:job-interval:*` (đã xoá lại sau khi đo). Có đầu đo `probe.mjs`, CPU profile `profile.mjs`, tổng hợp `analyze-vus.mjs`.
- Đạt ngưỡng ≥ 2/3 lần tới: đọc 300 VU (150 req/s), hỗn hợp 300 VU (148 req/s), gửi 200 VU (100 req/s). Lần 1 ở 200 VU có chạy profile nên chậm hơn.
- Trần một process: đọc ~296, hỗn hợp ~290, gửi ~207 req/s (tụt còn 178 ở 1000 VU). p95 ở 1000 VU: đọc 2,3 s, hỗn hợp 2,9 s, gửi 5,7 s; lỗi 3,7–5,9% (500 do chờ mượn kết nối quá 3 s).
- Nút thắt: luồng chính Node của core-api (ELU 100% từ 500 VU, CPU ~120% một nhân). Pool content 10/10 với tới 1.618 request chờ là hệ quả; Postgres trung bình 0,6–1,6 phiên chạy, CPU 65–76% một nhân. k6 25–45% một nhân, máy ~50%.
- Đề xuất: thêm process core-api (lưu ý 45 kết nối/process so với max_connections 100), tách APP_ROLE=api/worker, cắt quá tải bằng 503, giảm câu/request. Chi tiết và biểu đồ ở artifact "Bình luận: tải tới 1000 VU và nút thắt".

## Stress và spike (25/11, 08:52–09:59)

- `k6/stress.js` (kịch bản hỗn hợp, mỗi bài 3 lần), `run.sh vstress` / `vspike`, `analyze-stress.mjs`. Đầu đo thêm đếm mã phản hồi theo giây; lấy mẫu `XINFO GROUPS stream:core.content` mỗi giây.
- Stress 0 → 1500 VU/10 phút: luồng chính bận 80% ở ~350 VU, kín ở ~560; p95 > 150 ms ở ~610, > 1 s ở ~780; thông lượng đỉnh ~375 req/s ở ~1000 VU rồi tụt ~290 ở 1500; 5xx > 1% ở ~1340 VU (2/3 lần), 15% ở 1500 VU.
- Spike 50 → 1000 VU/10 s: p95 ~1,3 s, 0 lỗi.
- Hồi phục: p95 về bình thường ngay khi hạ tải (6/6 lần); heap 714 → 154 MB; số đếm khớp, phân trang đủ; stream discovery xả hết sau ~1 phút. Kiểm duyệt ở local không bắt kịp (không có AI).
- Lỗi của cách đo: token 15 phút hết hạn ở cuối stress (~130 lỗi 401 mỗi lần), đã loại khỏi phần hồi phục.

## So sánh 1 process và 2 process API + 1 worker trên local (25/11)
- `cluster.sh up a|b`: a = 1 process `APP_ROLE=all`, b = 2 process `APP_ROLE=api` + 1 `APP_ROLE=worker`, cả hai sau nginx ở cổng 3000. Các process phải dùng chung `AUTH_JWT_PRIVATE_KEY` (khoá riêng cho bài đo ở `out/bench-keys.env`, không commit); thiếu khoá thì token của process này bị process kia từ chối, một nửa lượt gửi trả 401.
- `run.sh` có `RUN_TAG` (tiền tố tên lượt) và lấy mẫu CPU từng process trong cụm; `analyze-ab.mjs` gộp số nhiều process (RPS cộng, p95 trên mảng gộp, ELU từng process) và so a với b.
- Kết quả (hỗn hợp, gửi; 100 → 1000 VU; 3 lần): hỗn hợp chịu được 300 → 500 VU (p95 ở 500 VU 168 → 104 ms, ở 750 VU 1,55 → 0,65 s), throughput đỉnh stress 351 → 378 RPS; gửi không cải thiện (300 VU) và chậm hơn từ 500 VU. Máy đo hết CPU (80–92%) và các lượt gửi cùng một bài tranh khoá nhiều hơn.

## Đo trên staging (26/11)
- k6 chạy trên VM riêng cùng zone (`K6_NATIVE=1`, `REMOTE=1`), tài khoản bench lấy từ biến môi trường (`BENCH_PASSWORD`, `BENCH_EMAIL_TEMPLATE`, `BENCH_POST_ID`), bài thử và 10.000 bình luận nền tạo qua API (`seed-api.mjs`). Kiểm duyệt AI tạm tắt, job gợi ý giãn 24 h trong giờ đo.
- Cấu hình 1 (1 core-api `all`) và cấu hình 2 (2 `api` + 1 `worker`), hỗn hợp và gửi 50 → 500 VU × 2 lần, stress 0 → 800 VU.
- Kết quả: cả hai chịu được ~50 VU; CPU server 4 vCPU kín từ ~100–200 VU (PostgreSQL ~1,5 nhân, ai-label-worker ~0,85, core-api ~1). Cấu hình 2 tệ hơn với hỗn hợp (p95 200 VU 0,68 → 1,66 s, lỗi từ ~400 thay vì ~500 VU, 65% so với 44% lỗi ở 800 VU), chỉ gửi ở 200 VU tốt hơn (2,07 → 1,10 s). Quá tải thì p95 chạm ~6 s: chờ mượn kết nối DB 3 s hai lần rồi 500.
- Dọn: xoá bài thử qua API, anh Phong dump DB rồi chạy `cleanup-bench-users.sql` (130.217 bình luận), trả cấu hình như cũ.

## Kiểm tra cho các phần thêm (25–26/11)
- `bash -n` cho `run.sh`, `cluster.sh`; `node --check` cho `analyze-*.mjs`, `seed-api.mjs`; `k6 inspect` cho `stress.js` (stress, stress800, spike).
- `analyze-ab.mjs` chạy trên dữ liệu giả (`out/ab-fixture`) và dữ liệu thật; `cleanup-bench-users.sql` chạy thử (ROLLBACK) trên DB local; `seed-api.mjs` và chế độ `REMOTE=1` chạy thử trên local trước khi dùng cho staging.
