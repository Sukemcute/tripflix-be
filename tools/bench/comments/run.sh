#!/usr/bin/env bash
# TF99: chạy benchmark bình luận và gom kết quả vào tools/bench/comments/out/.
#   bash tools/bench/comments/run.sh [all|seed|explain|read|load|stress|spike|soak|cleanup]
# all (mặc định) = seed + explain + read + load. Cần core-api đang chạy, Postgres chạy trong Docker.
# Biến môi trường:
#   BASE_URL      core-api nhìn từ máy chạy lệnh (mặc định http://localhost:3000)
#   K6_BASE_URL   core-api nhìn từ container k6 (mặc định http://host.docker.internal:3000)
#   PG_CONTAINER  container Postgres (mặc định tripflix-postgres-1), PG_DB (mặc định core)
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

run_k6() {
  local script="$1" name="$2" seconds="$3"; shift 3
  snapshot_tables "tables-$name-before.csv"
  start_lock_sampler "$name" "$seconds"
  # k6 báo mã lỗi khi có ngưỡng TRƯỢT: vẫn chạy tiếp để chụp thống kê và gom kết quả.
  docker run --rm -v "$HOST_DIR:/bench" "$K6_IMAGE" run --quiet -e BASE_URL="$K6_BASE_URL" "$@" "/bench/k6/$script" || true
  snapshot_tables "tables-$name-after.csv"
  kill "$SAMPLER_PID" 2>/dev/null || true
  wait "$SAMPLER_PID" 2>/dev/null || true
}

do_seed() {
  echo "== Seed: 1 bài thử, 10.000 bình luận =="
  psql_run -q < "$DIR/seed.sql"
}

do_explain() {
  echo "== R2: EXPLAIN =="
  psql_run < "$DIR/explain.sql" | tee "$OUT/r2-explain.txt"
}

do_read() { require_core; echo "== R1: đọc =="; run_k6 read.js r1-read 110; }
do_write() {
  local mode="$1" seconds="$2"
  require_core
  echo "== W1: ghi ($mode) =="
  run_k6 write.js "w1-$mode" "$seconds" -e MODE="$mode" -e SOAK_MINUTES="$SOAK_MINUTES"
}

case "$MODE" in
  all) do_seed; do_explain; do_read; do_write load 110 ;;
  seed) do_seed ;;
  explain) do_explain ;;
  read) do_read ;;
  load) do_write load 110 ;;
  stress) do_write stress 180 ;;
  spike) do_write spike 95 ;;
  soak) do_write soak "$((SOAK_MINUTES * 60 + 10))" ;;
  cleanup) psql_run < "$DIR/cleanup.sql"; exit 0 ;;
  *) echo "Không biết chế độ $MODE" >&2; exit 1 ;;
esac

node "$HOST_DIR/summarize.mjs"
echo "Kết quả: $OUT/summary.md"
