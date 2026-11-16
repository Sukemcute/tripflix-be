#!/usr/bin/env bash
# TF99: chạy benchmark bình luận và gom kết quả vào tools/bench/comments/out/.
#   bash tools/bench/comments/run.sh [all|seed|explain|read|rsweep|load|wsweep|paging|stress|spike|soak|cleanup]
# all (mặc định) = seed + explain + read + wsweep. Cần core-api đang chạy, Postgres chạy trong Docker.
# Mỗi kịch bản đo chạy RUNS lần (mặc định 3), bảng kết quả lấy trung vị: một lần đo trên laptop lệch 30–45%.
# Biến môi trường:
#   BASE_URL      core-api nhìn từ máy chạy lệnh (mặc định http://localhost:3000)
#   K6_BASE_URL   core-api nhìn từ container k6 (mặc định http://host.docker.internal:3000)
#   PG_CONTAINER  container Postgres (mặc định tripflix-postgres-1), PG_DB (mặc định core)
#   RUNS          số lần chạy mỗi kịch bản (mặc định 3)
#   SOAK_MINUTES  thời gian soak (mặc định 30)
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
  docker run --rm -v "$HOST_DIR:/bench" "$K6_IMAGE" run --quiet -e BASE_URL="$K6_BASE_URL" "$@" "/bench/k6/$script" || true
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
    run_k6 read.js "$name" "$name.run$i" "$seconds" -e READ_MODE="$read_mode"
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
  cleanup) psql_run < "$DIR/cleanup.sql"; exit 0 ;;
  *) echo "Không biết chế độ $MODE" >&2; exit 1 ;;
esac

node "$HOST_DIR/summarize.mjs"
echo "Kết quả: $OUT/summary.md"
