#!/usr/bin/env bash
# TF99: chạy benchmark bình luận và gom kết quả vào tools/bench/comments/out/.
#   bash tools/bench/comments/run.sh [all|seed|explain|read|rsweep|load|wsweep|paging|stress|spike|soak|vus|vstress|vspike|cleanup]
# all (mặc định) = seed + explain + read + wsweep. Cần core-api đang chạy, Postgres chạy trong Docker.
# Mỗi kịch bản đo chạy RUNS lần (mặc định 3), bảng kết quả lấy trung vị: một lần đo trên laptop lệch 30–45%.
# Biến môi trường:
#   BASE_URL      core-api nhìn từ máy chạy lệnh (mặc định http://localhost:3000)
#   K6_BASE_URL   core-api nhìn từ container k6 (mặc định http://host.docker.internal:3000)
#   PG_CONTAINER  container Postgres (mặc định tripflix-postgres-1), PG_DB (mặc định core)
#   RUNS          số lần chạy mỗi kịch bản (mặc định 3)
#   SOAK_MINUTES  thời gian soak (mặc định 30)
#   VUS_LEVELS    các mức VU của chế độ vus (mặc định "5 25 50 100 200"), KINDS (mặc định "read mixed write")
#   RUN_INDEX     chế độ vus: chỉ chạy lại lần thứ N (giữ các lần khác), vd khi một lần trúng job nền chặn core-api
#   PROFILE_AT    chế độ vus: lấy CPU profile core-api ở các mức "kiểu:VU" (vd "write:1000"), cần core-api chạy --inspect
#   vstress, vspike: stress và spike theo số người (k6/stress.js, kịch bản hỗn hợp), thêm mẫu độ trễ stream sự kiện
#   CORE_PORT     cổng core-api để tìm tiến trình lấy mẫu CPU (mặc định 3000, chỉ trên Windows)
#   REMOTE=1      đo server từ xa (BASE_URL, K6_BASE_URL trỏ tới server): bỏ seed SQL, lấy mẫu Docker/Postgres local, kiểm số đếm;
#                 truyền BENCH_PASSWORD, BENCH_EMAIL_TEMPLATE, BENCH_POST_ID, WALK_MAX_PAGES, SKIP_PAGING sang k6
#   K6_NATIVE=1   gọi k6 cài sẵn trên máy (vd VM đo riêng) thay vì chạy trong Docker
#   RUN_TAG       nhãn cấu hình (a hoặc b): gắn tiền tố vào tên lượt vus/vstress/vspike và lấy mẫu các process trong cụm
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# Docker Desktop trên Windows cần đường dẫn kiểu D:/...; Linux, macOS dùng đường dẫn thường.
HOST_DIR="$(cd "$DIR" && (pwd -W 2>/dev/null || pwd))"
OUT="$DIR/out"
MODE="${1:-all}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
K6_BASE_URL="${K6_BASE_URL:-http://host.docker.internal:3000}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.4.0}"
PG_CONTAINER="${PG_CONTAINER:-tripflix-postgres-1}"
PG_DB="${PG_DB:-core}"
RUNS="${RUNS:-3}"
SOAK_MINUTES="${SOAK_MINUTES:-30}"
export MSYS_NO_PATHCONV=1
mkdir -p "$OUT"

psql_run() { docker exec -i "$PG_CONTAINER" psql -U postgres -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"; }

require_core() {
  if ! curl -sf "$BASE_URL/api/v1/feed?limit=1" > /dev/null; then
    echo "Không gọi được core-api ở $BASE_URL. Bật core-api rồi chạy lại." >&2
    exit 1
  fi
}

# Số lượt quét bảng và số dòng thêm, chụp trước và sau mỗi lượt đo để tính trung bình mỗi request.
snapshot_tables() {
  psql_run -AtF',' -c "select schemaname||'.'||relname, seq_scan, coalesce(idx_scan, 0), n_tup_ins
    from pg_stat_user_tables
    where (schemaname, relname) in (('content','comments'), ('content','posts'), ('content','comment_reactions'), ('access','users'))
    order by 1" > "$OUT/$1"
}

# Lấy mẫu pg_stat_activity mỗi 100 ms: số phiên chờ khoá, đang chạy, đang mở transaction mà rảnh.
start_lock_sampler() {
  local name="$1" seconds="$2"
  local query="select to_char(clock_timestamp(), 'HH24:MI:SS.MS'),
    count(*) filter (where wait_event_type = 'Lock'),
    count(*) filter (where state = 'active'),
    count(*) filter (where state like 'idle in transaction%')
    from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()"
  printf '%s\n\\watch interval=0.1 count=%d\n' "$query" "$((seconds * 10))" \
    | docker exec -i "$PG_CONTAINER" psql -U postgres -d "$PG_DB" -AtF',' -q > "$OUT/locks-$name.csv" 2>/dev/null &
  SAMPLER_PID=$!
}

# Một lượt k6: name là tên tóm tắt k6 tự ghi (r1-read, w1-load...), run là tên lưu của lượt này (r1-read.run2).
run_k6() {
  local script="$1" name="$2" run="$3" seconds="$4"; shift 4
  snapshot_tables "tables-$run-before.csv"
  start_lock_sampler "$run" "$seconds"
  # k6 báo mã lỗi khi có ngưỡng TRƯỢT: vẫn chạy tiếp để chụp thống kê và gom kết quả.
  # Lượt trước bị ngắt có thể để lại container k6 cùng tên, làm lượt này không chạy được.
  if [ "${K6_NATIVE:-}" = 1 ]; then
    k6 run --quiet -e BASE_URL="$K6_BASE_URL" -e OUT_DIR="$OUT" "${K6_EXTRA_ENV[@]}" "$@" "$DIR/k6/$script" || true
  else
    docker rm -f tf99-k6 > /dev/null 2>&1 || true
    docker run --rm --name tf99-k6 -v "$HOST_DIR:/bench" "$K6_IMAGE" run --quiet -e BASE_URL="$K6_BASE_URL" "${K6_EXTRA_ENV[@]}" "$@" "/bench/k6/$script" || true
  fi
  snapshot_tables "tables-$run-after.csv"
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  mv "$OUT/$name.json" "$OUT/$run.json"
}

# Xoá kết quả cũ của một kịch bản để bảng tổng hợp không lẫn lượt của lần chạy trước.
clear_runs() {
  rm -f "$OUT/$1".run*.json "$OUT"/tables-"$1".run*.csv "$OUT"/locks-"$1".run*.csv
}

do_seed() {
  echo "== Seed: 1 bài thử, 10.000 bình luận =="
  psql_run -q < "$DIR/seed.sql"
}

do_explain() {
  echo "== R2: EXPLAIN =="
  psql_run < "$DIR/explain.sql" | tee "$OUT/r2-explain.txt"
}

do_read() {
  local read_mode="$1" name="$2" seconds="$3"
  require_core
  clear_runs "$name"
  # Lượt ghi trước đó làm bài dài thêm: đọc luôn đo trên đúng 10.000 bình luận seed (trừ chế độ paging).
  [ "${SKIP_SEED:-}" = 1 ] || do_seed
  for i in $(seq 1 "$RUNS"); do
    echo "== R1: đọc ($read_mode), lần $i/$RUNS =="
    run_k6 read.js "$name" "$name.run$i" "$seconds" -e READ_MODE="$read_mode" -e SUMMARY_NAME="$name"
  done
}

do_write() {
  local mode="$1" seconds="$2"
  require_core
  clear_runs "w1-$mode"
  for i in $(seq 1 "$RUNS"); do
    # Lượt ghi trước làm bài dài thêm: seed lại để lần nào cũng bắt đầu từ 10.000 bình luận.
    do_seed
    echo "== W1: ghi ($mode), lần $i/$RUNS =="
    run_k6 write.js "w1-$mode" "w1-$mode.run$i" "$seconds" -e MODE="$mode" -e SOAK_MINUTES="$SOAK_MINUTES"
  done
}

# Lấy mẫu tài nguyên của chế độ vus, mọi dòng có mốc giờ epoch ms để ghép với khung đo của k6:
#   res-host-<lượt>.csv:   giờ, CPU cả máy (%), CPU core-api (% một nhân), RAM core-api (MB) (Windows, tìm core-api theo cổng)
#   res-procs-<lượt>.csv:  giờ, tên, CPU cả máy (%), CPU process (% một nhân), RAM (MB) (khi có RUN_TAG và out/cluster-$RUN_TAG.txt)
#   res-docker-<lượt>.csv: giờ, container, CPU (% một nhân), RAM: Postgres, Redis và chính k6 (xem máy tạo tải có nghẽn không)
#   pg-<lượt>.csv:         giờ, số phiên, đang chạy, chờ khoá, chờ LWLock, chờ IO, chờ app (ClientRead), mở transaction mà rảnh
start_res_sampler() {
  local name="$1" pg_seconds="${2:-300}"
  RES_PIDS=()
  local cluster_file="$OUT/cluster-${RUN_TAG:-}.txt"
  if [ -n "${RUN_TAG:-}" ] && [ -f "$cluster_file" ]; then
    # Cổng 3000 giờ là nginx nên không dò PID theo cổng; lấy danh sách winpid trực tiếp từ file cụm.
    local targets
    targets="$(awk -F',' 'NF >= 3 && $3 ~ /^[0-9]+$/ { printf "%s%s:%s", (n++ ? "," : ""), $1, $3 }' "$cluster_file")"
    if [ -n "$targets" ] && command -v powershell.exe > /dev/null; then
      powershell.exe -NoProfile -Command "
        \$items = @()
        foreach (\$pair in '$targets'.Split(',')) {
          \$kv = \$pair.Split(':')
          \$p = Get-Process -Id ([int]\$kv[1]) -ErrorAction SilentlyContinue
          if (\$p) { \$items += [pscustomobject]@{ Name = \$kv[0]; Proc = \$p; Last = \$p.TotalProcessorTime.TotalMilliseconds; At = Get-Date } }
        }
        while (\$items.Count -gt 0) { \$host_cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime
          \$epoch = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
          foreach (\$it in \$items) {
            \$it.Proc.Refresh()
            if (\$it.Proc.HasExited) { continue }
            \$now = Get-Date; \$cpu = \$it.Proc.TotalProcessorTime.TotalMilliseconds; \$dt = (\$now - \$it.At).TotalMilliseconds
            if (\$dt -gt 0) { '{0},{1},{2},{3:F1},{4}' -f \$epoch, \$it.Name, \$host_cpu, ((\$cpu - \$it.Last) / \$dt * 100), [int](\$it.Proc.WorkingSet64 / 1MB) }
            \$it.Last = \$cpu; \$it.At = \$now
          }
          Start-Sleep -Milliseconds 700 }" > "$OUT/res-procs-$name.csv" 2>/dev/null &
      RES_PIDS+=($!)
    fi
  else
    local core_pid
    core_pid="$(netstat -ano 2>/dev/null | awk -v port=":${CORE_PORT:-3000}" '$2 ~ port"$" && $4 == "LISTENING" { print $5; exit }')"
    if [ -n "$core_pid" ] && command -v powershell.exe > /dev/null; then
      powershell.exe -NoProfile -Command "
        \$p = Get-Process -Id $core_pid; \$last = \$p.TotalProcessorTime.TotalMilliseconds; \$at = Get-Date
        while (\$true) { \$host_cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime
          \$p.Refresh(); \$now = Get-Date; \$cpu = \$p.TotalProcessorTime.TotalMilliseconds
          '{0},{1},{2:F1},{3}' -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds(), \$host_cpu, ((\$cpu - \$last) / (\$now - \$at).TotalMilliseconds * 100), [int](\$p.WorkingSet64 / 1MB)
          \$last = \$cpu; \$at = \$now; Start-Sleep -Milliseconds 700 }" > "$OUT/res-host-$name.csv" 2>/dev/null &
      RES_PIDS+=($!)
    fi
  fi
  ( while :; do
      local now; now="$(date +%s%3N)"
      docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' "$PG_CONTAINER" "${REDIS_CONTAINER:-tripflix-redis-1}" $(docker ps -q --filter name=tf99-k6) 2>/dev/null \
        | sed "s/^/$now,/"
    done ) > "$OUT/res-docker-$name.csv" &
  RES_PIDS+=($!)
  local query="select (extract(epoch from clock_timestamp()) * 1000)::bigint, count(*),
    count(*) filter (where state = 'active'),
    count(*) filter (where wait_event_type = 'Lock'),
    count(*) filter (where wait_event_type = 'LWLock'),
    count(*) filter (where wait_event_type = 'IO'),
    count(*) filter (where state = 'active' and wait_event = 'ClientRead'),
    count(*) filter (where state like 'idle in transaction%')
    from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'"
  printf '%s\n\watch interval=0.2 count=%d\n' "$query" "$((pg_seconds * 5))" \
    | docker exec -i "$PG_CONTAINER" psql -U postgres -d "$PG_DB" -AtF',' -q > "$OUT/pg-$name.csv" 2>/dev/null &
  RES_PIDS+=($!)
}

# Mỗi giây: lag (chưa đọc) và pending (đã nhận, chưa xác nhận) của từng nhóm consumer trên stream:core.content.
# Lag dồn lên khi consumer chạy chung luồng chính bị bỏ đói; hồi phục nghĩa là lag về lại mức trước khi đo.
# Mỗi dòng: giờ epoch ms rồi nguyên dòng CSV của XINFO GROUPS (analyze-stress.mjs tách theo cặp khoá, giá trị).
start_stream_sampler() {
  ( while :; do
      local now; now="$(date +%s%3N)"
      echo "$now,$(docker exec "${REDIS_CONTAINER:-tripflix-redis-1}" redis-cli --csv XINFO GROUPS stream:core.content 2>/dev/null | tr -d '"')"
      sleep 1
    done ) > "$OUT/stream-$1.csv" &
  RES_PIDS+=($!)
}

stop_res_sampler() {
  for pid in "${RES_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  # powershell.exe và psql trong container chạy ngoài MSYS: kill chỉ dừng lớp bọc, dọn nốt tiến trình con còn sót.
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { \$_.CommandLine -like '*TotalProcessorTime*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null || true
  docker exec "$PG_CONTAINER" pkill -f 'psql -U postgres -d' 2>/dev/null || true
}

# Sau lượt có ghi: chờ job cộng bảng đệm (mỗi 1 s) rồi so comment_count với số bình luận thật.
check_comment_count() {
  sleep 3
  psql_run -AtF',' -c "select p.comment_count,
      (select count(*) from content.comments c where c.post_id = p.id),
      (select coalesce(sum(comment_delta), 0) from content.post_counter_deltas d where d.post_id = p.id)
    from content.posts p where p.id = '0000be0c-0000-4000-8000-000000000001'" > "$OUT/count-$1.csv"
}

# Chế độ vus: mỗi mức VU là một lượt k6 riêng (levels.js). Vòng ngoài là số lần chạy để độ lệch của máy chia đều các mức.
do_vus() {
  require_core
  local kinds="${KINDS:-read mixed write}" levels="${VUS_LEVELS:-5 25 50 100 200}" prefix="${RUN_TAG:+$RUN_TAG-}"
  [ -n "${RUN_INDEX:-}" ] || for kind in $kinds; do for vus in $levels; do local base="${prefix}v-$kind-$vus"; clear_runs "$base"; rm -f "$OUT"/res-*-"$base".run*.csv "$OUT"/pg-"$base".run*.csv "$OUT"/count-"$base".run*.csv; done; done
  for i in $(if [ -n "${RUN_INDEX:-}" ]; then echo "$RUN_INDEX"; else seq 1 "$RUNS"; fi); do
    for kind in $kinds; do
      for vus in $levels; do
        local name="v-$kind-$vus" run="${prefix}v-$kind-$vus.run$i"
        do_seed
        echo "== $kind, $vus VU, lần $i/$RUNS =="
        start_res_sampler "$run"
        # CPU profile core-api giữa phần đo (core-api chạy với --inspect): PROFILE_AT="write:1000 read:1000", chỉ lần 1.
        local profile_pid=""
        if [ "$i" = 1 ] && [[ " ${PROFILE_AT:-} " == *" $kind:$vus "* ]]; then
          ( sleep "${PROFILE_DELAY:-45}"; node "$HOST_DIR/profile.mjs" 20 "$HOST_DIR/out/profile-$name.json" > /dev/null ) &
          profile_pid=$!
        fi
        run_k6 levels.js "$name" "$run" 75 -e KIND="$kind" -e VUS="$vus"
        [ -z "$profile_pid" ] || wait "$profile_pid" || true
        stop_res_sampler
        [ "$kind" = read ] || check_comment_count "$run"
        sleep "${GAP_SECONDS:-20}"
      done
    done
  done
}

# Stress và spike theo số người: shape là stress hoặc spike, seconds là thời lượng k6 (để lấy mẫu Postgres đủ dài).
do_vstress() {
  local shape="$1" seconds="$2" prefix="${RUN_TAG:+$RUN_TAG-}"
  local base="${prefix}s-$shape"
  require_core
  [ -n "${RUN_INDEX:-}" ] || { clear_runs "$base"; rm -f "$OUT"/res-*-"$base".run*.csv "$OUT"/pg-"$base".run*.csv "$OUT"/stream-"$base".run*.csv "$OUT"/count-"$base".run*.csv; }
  for i in $(if [ -n "${RUN_INDEX:-}" ]; then echo "$RUN_INDEX"; else seq 1 "$RUNS"; fi); do
    local run="$base.run$i"
    do_seed
    echo "== $shape, lần $i/$RUNS =="
    start_res_sampler "$run" "$((seconds + 180))"
    start_stream_sampler "$run"
    run_k6 stress.js "s-$shape" "$run" "$seconds" -e KIND=mixed -e SHAPE="$shape"
    # Theo dõi thêm 30 s sau khi k6 dừng: stream sự kiện còn dồn thì chưa hồi phục hẳn.
    sleep 30
    stop_res_sampler
    check_comment_count "$run"
    sleep "${GAP_SECONDS:-60}"
  done
}

# Đo server từ xa: không có quyền vào Docker, DB của server nên các bước local thành rỗng (người quản trị server lấy mẫu).
K6_EXTRA_ENV=()
if [ "${REMOTE:-}" = 1 ]; then
  snapshot_tables() { :; }
  start_lock_sampler() { SAMPLER_PID=""; }
  do_seed() { echo "== REMOTE: dùng bài thử đã tạo qua API (BENCH_POST_ID=${BENCH_POST_ID:-?}) =="; }
  start_res_sampler() { RES_PIDS=(); }
  start_stream_sampler() { :; }
  check_comment_count() { :; }
  for var in BENCH_PASSWORD BENCH_EMAIL_TEMPLATE BENCH_POST_ID WALK_MAX_PAGES SKIP_PAGING; do
    [ -z "${!var:-}" ] || K6_EXTRA_ENV+=(-e "$var=${!var}")
  done
fi

case "$MODE" in
  all) do_seed; do_explain; do_read rate r1-read 140; do_write sweep 110 ;;
  # Bình luận do app ghi dồn dập có nhiều cái chung mili giây: đi hết trang để bắt lỗi cursor bỏ sót.
  paging) RUNS=1 do_write sweep 110; RUNS=1 SKIP_SEED=1 do_read sweep r1-paging 115 ;;
  seed) do_seed ;;
  explain) do_explain ;;
  read) do_read rate r1-read 140 ;;
  rsweep) do_read sweep r1-sweep 115 ;;
  load) do_write load 110 ;;
  wsweep) do_write sweep 110 ;;
  stress) do_write stress 180 ;;
  spike) do_write spike 95 ;;
  soak) do_write soak "$((SOAK_MINUTES * 60 + 10))" ;;
  vus) do_vus ;;
  vstress) do_vstress stress 1000 ;;
  vspike) do_vstress spike 340 ;;
  vstress800) do_vstress stress800 800 ;;
  cleanup) psql_run < "$DIR/cleanup.sql"; exit 0 ;;
  *) echo "Không biết chế độ $MODE" >&2; exit 1 ;;
esac

node "$HOST_DIR/summarize.mjs"
if [ -n "${RUN_TAG:-}" ]; then
  # Cụm nhiều process ghi probe riêng từng process, không dùng analyze-vus/stress của chế độ 1 process.
  [ ! -f "$DIR/analyze-ab.mjs" ] || node "$HOST_DIR/analyze-ab.mjs" > /dev/null
else
  [ "$MODE" != vus ] || node "$HOST_DIR/analyze-vus.mjs" > /dev/null
  case "$MODE" in vstress|vspike) node "$HOST_DIR/analyze-stress.mjs" > /dev/null ;; esac
fi
echo "Kết quả: $OUT/summary.md"
