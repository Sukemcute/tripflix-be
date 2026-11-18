#!/usr/bin/env bash
# Đo thời gian trả lời của GET /api/v1/feed theo tab, trên stack local. In p50, p95 (ms) của:
#   - trang đầu khi cache trống (xoá khoá feed:first-page:* trước mỗi lần gọi),
#   - trang đầu khi cache sẵn (điền đủ 16 khoá seed song song rồi đo trong 10 giây cache còn sống),
#   - trang 2 (đi theo cursor, không qua cache).
# Chỉ chạy trên local: lệnh xoá cache dùng redis-cli trong container. Trên staging xem README (chỉ đo trang 2).
#
#   bash tools/bench/feed/run.sh <nhãn>            ví dụ: bash tools/bench/feed/run.sh A
#   RUNS=3 N=20 bash tools/bench/feed/run.sh B
set -euo pipefail

LABEL=${1:-run}
API=${API:-http://localhost:3000/api/v1/feed}
REDIS_CONTAINER=${REDIS_CONTAINER:-tripflix-bench-redis-1}
N=${N:-20}
RUNS=${RUNS:-3}
WARM_REQUESTS=10
# Feed chọn 1 trong 16 seed mỗi lần gọi, mỗi seed một khoá: 48 request song song gần như chắc chắn điền đủ.
FILL_REQUESTS=48

flush_first_page_cache() {
  docker exec "$REDIS_CONTAINER" sh -c "redis-cli --scan --pattern 'feed:first-page:*' | xargs -r redis-cli del >/dev/null"
}

percentiles() {
  sort -n | awk '{a[NR]=$1} END {printf "p50 %4.0f ms · p95 %4.0f ms", a[int(NR*0.5+0.5)], a[int(NR*0.95+0.5)]}'
}

time_ms() {
  curl -s -o /dev/null -w '%{time_total}\n' "$1" | awk '{print $1*1000}'
}

next_cursor() {
  curl -s "$1" | python3 -c 'import sys, json, urllib.parse; print(urllib.parse.quote(json.load(sys.stdin).get("nextCursor") or ""))'
}

for run in $(seq "$RUNS"); do
  for tab in for_you hot; do
    url="$API?limit=10&tab=$tab"
    curl -s -o /dev/null "$url"

    cold=$(for _ in $(seq "$N"); do flush_first_page_cache; time_ms "$url"; done | percentiles)

    for _ in $(seq "$FILL_REQUESTS"); do curl -s -o /dev/null "$url" & done
    wait
    warm=$(for _ in $(seq "$WARM_REQUESTS"); do time_ms "$url"; done | percentiles)

    cursor=$(next_cursor "$url")
    page2=$(for _ in $(seq "$N"); do time_ms "$url&cursor=$cursor"; done | percentiles)

    printf '%s#%s %-8s | trang đầu, cache trống: %s | cache sẵn: %s | trang 2: %s\n' \
      "$LABEL" "$run" "$tab" "$cold" "$warm" "$page2"
  done
done
