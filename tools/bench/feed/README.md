# Benchmark feed (`GET /api/v1/feed`)

Đo thời gian trả lời của feed theo tab khi số bài video tăng. Mốc đo đầu tiên là ngày 18/11/2026, trước khi sửa cơ chế chấm điểm. Sau khi sửa, chạy lại đúng các bước dưới đây và ghi thêm một bảng vào mục "Kết quả".

Chỉ chạy `run.sh` trên **stack local riêng**, vì script xoá khoá cache feed trong Redis. Trên staging chỉ đo trang 2 (mục "Đo trên staging").

## Vì sao đo
- Tab "Dành cho bạn" (`for_you`) chấm điểm **mọi bài video ở mỗi lần đọc**, theo `ln(1 + điểm hot) / (giờ tuổi + 2)^1.2`, nhân hệ số `0,5 + md5(seed:id)`. Thời gian vì vậy tăng theo số bài.
- Tab "Đang hot" (`hot`) đọc theo bộ đếm có index, không chấm từng bài.
- Cache trang đầu không đủ để bù: mỗi lượt chọn 1 trong 16 seed, mỗi seed một khoá, mỗi khoá chỉ sống 10 giây. Lúc ít người, phần lớn lượt tải trượt cache. Trang 2 trở đi không bao giờ qua cache.

## Dựng dữ liệu

Dùng một stack riêng (`-p tripflix-bench`) để không đụng DB dev. Các lệnh chạy ở gốc repo.

```bash
pnpm install && pnpm turbo run build --filter=@tripflix/core-api...
docker compose -p tripflix-bench -f deploy/compose.yaml --profile be up -d --build core-api
```

**Trạng thái A:** 10 bài mẫu cộng 1.000 reel mẫu (TF10), tổng 1.006 bài video, giống staging trước khi nạp dữ liệu mô phỏng.

```bash
LOADTEST_PASSWORD=tripflix-dev-123 node tools/loadtest/gen-users-sql.mjs 500 \
  | docker exec -i tripflix-bench-postgres-1 psql -U postgres -d core
# Chạy lại migrate + seed để seed thấy tài khoản loadtest và tạo 1.000 reel mẫu
docker compose -p tripflix-bench -f deploy/compose.yaml --profile be run --rm migrate
```

**Trạng thái B:** A cộng dữ liệu mô phỏng gợi ý TF107, tổng 9.809 bài video.
- Cần thư mục data của Duy (bộ sinh v2, seed 42).
- Feed chỉ đọc `content`, nên không cần bước `ingest`.

```bash
cd apps/core-api
DATABASE_URL_ACCESS=postgres://tf_access:tf_access_dev@localhost:5432/core \
DATABASE_URL_CONTENT=postgres://tf_content:tf_content_dev@localhost:5432/core \
DATABASE_URL_DISCOVERY=postgres://tf_discovery:tf_discovery_dev@localhost:5432/core \
REDIS_URL=redis://localhost:6379 SEED_PASSWORD=tripflix-dev-123 \
node dist/cli/sim-recommend.js seed-state --data <thư mục data> --yes
cd ../..
docker exec tripflix-bench-postgres-1 psql -U postgres -d core -c 'analyze content.posts; analyze content.reactions; analyze content.comments;'
```

## Chạy

```bash
bash tools/bench/feed/run.sh A           # mặc định RUNS=3, N=20
RUNS=3 N=20 bash tools/bench/feed/run.sh B
```

**Mỗi dòng kết quả in p50 và p95 (ms) của ba trường hợp:**

| Trường hợp | Cách đo | Ý nghĩa |
|---|---|---|
| Trang đầu, cache trống | Xoá `feed:first-page:*` trước mỗi lần gọi | Chi phí thật của câu chấm điểm |
| Trang đầu, cache sẵn | Bắn 48 request song song để điền đủ 16 khoá seed, rồi đo 10 lần trong 10 giây cache còn sống | Mức trần khi cache trúng |
| Trang 2 | Đi theo cursor, không qua cache | Mọi lần cuộn tiếp |

**Biến môi trường:**

| Biến | Mặc định |
|---|---|
| `API` | `http://localhost:3000/api/v1/feed` |
| `REDIS_CONTAINER` | `tripflix-bench-redis-1` |
| `N` | `20` |
| `RUNS` | `3` |

**Lưu ý khi đo:**
- Bỏ lượt đo đầu tiên ngay sau khi core-api khởi động hoặc vừa seed. Lần đó trang đầu đo được tới khoảng 950 ms do code và DB còn "lạnh"; các lần sau ổn định ở 13 ms.
- So sánh giữa các trạng thái chỉ có nghĩa khi chạy trên cùng máy, cùng stack.

**Reels gợi ý của discovery** (`GET /api/recommendations/reels`, web Reels từ TF108). Script đăng nhập bằng một user mô phỏng (`EMAIL`, mặc định `usr_00001@sim.tripflix.local`), rồi đo 4 mode ở trang đầu và trang 2:

```bash
N=20 bash tools/bench/feed/reels.sh
```

## Đo trên staging (chỉ đọc)

Đo **trên VM**, gọi `127.0.0.1:3000`, để bỏ thời gian đi đường mạng: từ laptop ở Việt Nam, riêng `/health` đã mất khoảng 600 ms. Chỉ đo trang 2, vì trang này không qua cache, nên không cần xoá cache staging.

```bash
gcloud compute ssh tripflix-staging --zone=asia-southeast1-b --tunnel-through-iap
B=http://127.0.0.1:3000/api/v1/feed
for tab in for_you hot; do
  cur=$(curl -s "$B?limit=10&tab=$tab" | python3 -c 'import sys,json,urllib.parse; print(urllib.parse.quote(json.load(sys.stdin).get("nextCursor") or ""))')
  for i in $(seq 20); do curl -s -o /dev/null -w '%{time_total}\n' "$B?limit=10&tab=$tab&cursor=$cur"; done \
    | sort -n | awk -v t=$tab '{a[NR]=$1*1000} END {printf "%s trang 2: p50 %.0f ms · p95 %.0f ms\n", t, a[10], a[19]}'
done
```

## Kết quả

### Mốc 18/11/2026: trước khi sửa cơ chế chấm điểm (`develop` `e1a7897`)

**Local** (MacBook, Docker Desktop, stack `tripflix-bench`). Thời gian là p50, kèm p95 khi khác đáng kể. Mỗi ô là khoảng của 3 vòng, mỗi vòng N = 20.

| | A: 1.006 bài video | B: 9.809 bài video |
|---|---|---|
| `for_you`, trang đầu, cache trống | 13 ms | 78–85 ms (p95 tới 239 ms) |
| `for_you`, trang 2 | 13–14 ms | 92–98 ms (p95 97–121 ms) |
| `hot`, trang đầu, cache trống | 5 ms | 6–9 ms |
| `hot`, trang 2 | 5 ms | 6–7 ms |
| Trúng cache (cả hai tab) | 3 ms | 3–5 ms |

**Staging**, đo trên VM, trạng thái B cộng 41 bài thật (9.823 bài video):

| | p50 | p95 |
|---|---|---|
| `for_you`, trang 2 | 325 ms | 585 ms |
| `for_you`, trang đầu (lẫn trúng và trượt cache) | 221 ms | 236 ms |
| `hot`, trang 2 | 17 ms | 21 ms |
| `/health` | 9 ms | 13 ms |

**Đọc kết quả:**
- **`for_you` tăng gần tỉ lệ với số bài:** số bài video tăng 9,8 lần thì thời gian tăng 6–7 lần, ở cả trang đầu khi cache trống và trang 2.
- **`hot` gần như không đổi:** thêm bài không làm tab này chậm hơn.
- **VM staging chậm hơn laptop khoảng 3,4 lần.** Staging không được đo trước khi nạp dữ liệu mô phỏng. Ước theo tỉ lệ ở local, trước khi nạp khoảng 50 ms, nghĩa là dữ liệu mô phỏng thêm khoảng 270 ms cho mỗi trang không trúng cache.
- **Mục tiêu khi sửa:**
  - `for_you` trang 2 gần với `hot`, cỡ vài chục ms ở trạng thái B.
  - Thời gian không tăng theo số bài khi đi từ A sang B.

### Mốc 18/11/2026: Reels gợi ý của discovery, so với `/v1/feed`

Lý do đo: PR tripflix-fe#218 (TF108) chuyển tab Reels của web sang discovery. Mobile vẫn gọi `/v1/feed`.

Đo trên local, trạng thái B (9.809 bài video), cùng stack `tripflix-bench`, `develop` `e1a7897`. User đo là `usr_00001`, N = 20, đo 1 vòng. Discovery đã có điểm `hot@v2` cho 9.809 bài video.

| | `/v1/feed` (bảng trên) | `/api/recommendations/reels` |
|---|---|---|
| Dành cho bạn, trang đầu | 78–85 ms (trúng cache 3 ms) | 85 ms · p95 204 ms, không có cache |
| Dành cho bạn, trang 2 | 92–98 ms | 48 ms · p95 71 ms |
| Thịnh hành / `hot`, trang đầu | 6–9 ms | 40 ms · p95 71 ms (khách: 35 ms) |
| Thịnh hành / `hot`, trang 2 | 6–7 ms | 37 ms · p95 89 ms |
| Có lịch trình, trang đầu / trang 2 | không có | 18 ms / 18 ms |
| Gần đây, trang đầu / trang 2 | không có | 9 ms / 10 ms |

Mọi mode đều trả đủ 20 thẻ và có `nextCursor`.

**Đọc kết quả:**
- **Không làm benchmark `/v1/feed` tốt lên:** mobile vẫn gọi `/v1/feed`, nên vấn đề của TF110 vẫn còn nguyên.
- **Discovery đọc điểm đã tính sẵn theo lô** (`recommend_post_scores`) và giới hạn số ứng viên (150 hot, 50 mới, 500 explore). Vì vậy trang 2 "Dành cho bạn" nhanh gấp khoảng 2 lần feed. Thời gian chắc không tăng theo số bài, nhưng đây là suy từ code: chưa đo ở trạng thái A.
- **Trang đầu "Dành cho bạn" không nhanh hơn**, và không có cache dùng chung. Khi đông người, web mất mức 3 ms của cache trang đầu bên feed. Mỗi lượt gọi có đăng nhập còn ghi Redis để đánh dấu "đã gợi ý".
- **"Thịnh hành" chậm hơn tab `hot` của feed khoảng 5 lần** (37–40 ms so với 6–9 ms), nhưng vẫn ở mức vài chục ms.
- **Hai định nghĩa "xu hướng" cùng lúc:**
  - Web "Thịnh hành" xếp theo `hot@v2` của discovery.
  - Mobile "Đang hot" xếp theo bộ đếm của feed.

  Phong quyết khi lên kế hoạch TF110: feed dùng chung điểm `hot@v2` của discovery (qua facade), hay giữ bộ điểm riêng.
