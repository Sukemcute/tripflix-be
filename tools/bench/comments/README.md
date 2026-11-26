# Benchmark bình luận (TF99)

Đo đọc, ghi bình luận trên một bài 10.000 bình luận bằng k6 chạy trong Docker. Chỉ chạy trên DB local hoặc DB riêng để đo, **không chạy trên staging**.

## Cần có
- Docker (Postgres, Redis, Mailpit của `deploy/compose.yaml`), core-api đang chạy.
- Lần đầu: 5 tài khoản thử `bench-1..5@tripflix.local`. Tạo bằng luồng đăng ký thật, cần notification-service để gửi mã qua Mailpit:
  ```bash
  docker build -f apps/notification-service/Dockerfile --target dev -t tripflix-notification-service .
  docker compose -f deploy/compose.yaml up -d --no-deps --no-build notification-service
  node tools/bench/comments/setup-users.mjs
  docker compose -f deploy/compose.yaml stop notification-service
  ```
  `--no-deps` để không chạy container `migrate` (container này còn chạy `db:seed`).

## Chạy
```bash
bash tools/bench/comments/run.sh            # seed + R2 (EXPLAIN) + R1 (đọc) + W1 sweep (ghi), khoảng 15 phút
bash tools/bench/comments/run.sh read       # R1: giữ 25 → 200 request/giây, mỗi bậc 20 s; bậc cao nhất còn ĐẠT là sức đọc
bash tools/bench/comments/run.sh rsweep     # R1: 1, 5, 10, 25, 50 người đọc không nghỉ (đường sức chứa)
bash tools/bench/comments/run.sh wsweep     # W1: 1, 2, 5, 10, 25 người gửi không nghỉ (đường sức ghi)
bash tools/bench/comments/run.sh paging     # ghi dồn dập rồi đi hết trang: bắt lỗi cursor bỏ sót bình luận
bash tools/bench/comments/run.sh load       # W1: 50, 100, 200 người gửi, mỗi mức 30 s
bash tools/bench/comments/run.sh stress     # giữ 50 → 800 request/giây, tìm điểm vỡ
bash tools/bench/comments/run.sh spike      # 10 → 500 → 10 request/giây (bài viral)
SOAK_MINUTES=30 bash tools/bench/comments/run.sh soak   # 20 request/giây trong 30 phút
bash tools/bench/comments/run.sh vus        # đọc, hỗn hợp, gửi ở 5, 25, 50, 100, 200 VU, mỗi mức một lượt riêng, khoảng 80 phút
bash tools/bench/comments/run.sh cleanup    # xoá bài thử và bình luận của nó
cat tools/bench/comments/out/summary.md     # bảng kết quả
```
Mỗi kịch bản chạy `RUNS` lần (mặc định 3), bảng lấy trung vị kèm khoảng p95 thấp–cao: trên laptop một lần đo lệch 30–45%. k6 in **ĐẠT/TRƯỢT** theo ngưỡng ngay khi chạy xong. `out/` chứa JSON đầy đủ của k6, mẫu chờ khoá, thống kê bảng, không commit.

## Chế độ `vus` (đo theo số người dùng)
- `k6/levels.js`: mỗi lượt là một mức VU, mỗi VU nghỉ 1–3 s giữa hai thao tác như người thật. Khởi động 10 s không tính, đo 60 s.
- Ba kiểu (`KIND`): `read` đọc trang 1, 50, cuối; `write` gửi bình luận (20% là trả lời); `mixed` 80% đọc, 15% gửi, 5% mở trả lời.
- Seed lại trước mỗi lượt. Sau lượt có ghi: so `comment_count` với số bình luận thật (sau khi job cộng bảng đệm) và đi hết trang xem có thiếu, lặp.
- Lấy mẫu CPU mỗi giây: core-api (Windows, tìm tiến trình theo cổng `CORE_PORT`) và container Postgres (`docker stats`).
- Đổi mức, kiểu: `VUS_LEVELS="5 25" KINDS="read" RUNS=1 bash tools/bench/comments/run.sh vus`.

## Đo từ máy khác
Chạy k6 ở máy tạo tải, trỏ vào server cần đo:
```bash
K6_BASE_URL=http://<ip-server>:3000 BASE_URL=http://<ip-server>:3000 bash tools/bench/comments/run.sh read
```
Seed, EXPLAIN và lấy mẫu khoá cần chạy `psql` trong container Postgres của server: chạy `run.sh seed`, `run.sh explain` trên chính server đó.

## Đọc kết quả
- **p50, p95, p99:** 50%, 95%, 99% request xong trong thời gian này.
- **Request/giây:** số request thật của bậc chia thời lượng bậc. Ở chế độ giữ tốc độ, số này thấp hơn mục tiêu nghĩa là server không theo kịp; **Lượt bị bỏ** > 0 nghĩa là k6 hết VU để gửi.
- **Lượt quét mỗi request:** số lần quét bảng (theo `pg_stat_user_tables`) chia cho số request; quét tuần tự là quét cả bảng.
- **Chờ khoá:** lấy mẫu `pg_stat_activity` mỗi 100 ms; nhiều phiên chờ khoá khi ghi nghĩa là các bình luận đang xếp hàng chờ dòng bài (`FOR UPDATE`).
- **Phân trang:** R1 đi hết các trang như bấm "Xem thêm", so số bình luận thấy được với `total`.
- Đo trên một máy thì k6, core-api, Postgres dùng chung CPU: số đo dùng để so trước và sau khi sửa, không phải sức chịu của production.

## Chế độ `vstress`, `vspike` (stress và spike theo số người)

`bash tools/bench/comments/run.sh vstress` (khoảng 18 phút mỗi lần) và `run.sh vspike` (khoảng 7 phút mỗi lần), kịch bản hỗn hợp của `levels.js`, mỗi request gắn tag `phase`. Stress tăng 0 → 1500 VU trong 10 phút, giữ 2 phút, hạ về 50 VU, theo dõi 3 phút; spike 50 → 1000 VU trong 10 s, giữ 1 phút. Cần core-api chạy với đầu đo (`probe.mjs`). `analyze-stress.mjs` ghép diễn biến từng giây, tìm điểm gãy và thời gian hồi phục, ghi `out/stress-analysis.json` và `out/stress-report.md`. Token đăng nhập sống 15 phút nên cuối bài stress có vài lỗi 401.

## So sánh nhiều process (`cluster.sh`, `RUN_TAG`)

`bash tools/bench/comments/cluster.sh up a` (1 process `all`) hoặc `up b` (2 `api` + 1 `worker`), sau nginx ở cổng 3000; `down` để tắt. Cấu hình b cần `out/bench-keys.env` có `AUTH_JWT_PRIVATE_KEY` dùng chung (tạo bằng `(cd apps/core-api && node dist/cli/keygen.js) > tools/bench/comments/out/bench-keys.env`). Đo: `RUN_TAG=a bash tools/bench/comments/run.sh vus` (và `vstress`), rồi `node tools/bench/comments/analyze-ab.mjs` → `out/ab-analysis.json`, `out/ab-report.md`.

## Đo server từ xa (`REMOTE=1`)

Dùng khi không có quyền vào Docker, DB của server: `REMOTE=1 BASE_URL=https://<api> K6_BASE_URL=https://<api>` cùng `BENCH_PASSWORD`, `BENCH_EMAIL_TEMPLATE`, `BENCH_POST_ID` (không ghi vào repo). `WALK_MAX_PAGES=400 SKIP_PAGING=1` để không đi hết trang khi bình luận dồn lại; `K6_NATIVE=1` khi máy đo cài k6 sẵn (không Docker). Tạo bài thử và 10.000 bình luận nền qua API: `node tools/bench/comments/seed-api.mjs create`; xoá bài qua API: `seed-api.mjs delete <postId>`. Dọn dữ liệu bench trên DB (người có quyền ghi, sau khi dump): `cleanup-bench-users.sql`, mặc định chạy thử rồi ROLLBACK.
