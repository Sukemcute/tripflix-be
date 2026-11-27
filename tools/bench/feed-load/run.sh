#!/bin/sh
# TF120: chạy trên VM k6 (tripflix-k6), trong thư mục tools/bench/feed-load đã chép lên.
#   MIX=hot sh run.sh scale <nhãn>   chỉ tab Đang hot (xem k6/scale.js)
#   sh run.sh scale <nhãn>     phép 2, nhãn là cấu hình (c1 = 1 bản all, c2 = 2 api + 1 worker); RATES="25 50 100 150 200"
#   sh run.sh cdn              phép 1; LEVELS="50 100 250 500"
#   sh run.sh events           phép 4; VUS=500
# Mỗi lượt ghi out/<kịch bản>-<mức>.json (summary k6) và một dòng giờ bắt đầu, kết thúc vào out/runs.csv
# để analyze.mjs ghép với số mẫu của server. Nghỉ REST giây giữa hai mức để server về trạng thái nghỉ.
set -eu
cd "$(dirname "$0")"
mkdir -p out
[ -f out/runs.csv ] || echo "scenario,label,level,start,end,exit" > out/runs.csv
BASE_URL=${BASE_URL:-https://api.tripflix.io.vn}
REST=${REST:-30}

run() { # run <kịch bản> <nhãn> <mức> <file k6> [-e ...]
  scenario=$1 label=$2 level=$3 file=$4; shift 4
  start=$(date -u +%FT%TZ)
  code=0
  k6 run --quiet -e BASE_URL="$BASE_URL" "$@" --summary-export "out/$scenario-$label-$level.json" "k6/$file" || code=$?
  echo "$scenario,$label,$level,$start,$(date -u +%FT%TZ),$code" >> out/runs.csv
  # 99: trượt ngưỡng (vẫn có số đo). Mã khác là k6 lỗi thật: dừng.
  [ "$code" -eq 0 ] || [ "$code" -eq 99 ] || { echo "k6 lỗi (mã $code), dừng"; exit "$code"; }
  # Lỗi quá STOP_FAIL (mặc định 5%) thì không bắn mức cao hơn: staging là máy dùng chung.
  failed=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["metrics"]["http_req_failed"]["value"])' "out/$scenario-$label-$level.json")
  echo "$scenario $label $level: lỗi $failed"
  if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)' "$failed" "${STOP_FAIL:-0.05}"; then
    echo "Lỗi quá ${STOP_FAIL:-0.05}, dừng ở mức $level"
    exit 0
  fi
  sleep "$REST"
}

case "${1:-}" in
  scale)
    label=${2:?cần nhãn cấu hình, ví dụ c1 hoặc c2}
    for r in ${RATES:-25 50 100 150 200}; do run scale "$label" "$r" scale.js -e MIX="${MIX:-mixed}" -e RATE="$r" -e DURATION="${DURATION:-60s}"; done ;;
  cdn)
    for n in ${LEVELS:-50 100 250 500}; do run cdn "${2:-c}" "$n" cdn.js -e VUS="$n" -e DURATION="${DURATION:-2m}"; done ;;
  events)
    run events "${2:-c}" "${VUS:-500}" events.js -e VUS="${VUS:-500}" ;;
  *) echo "Dùng: sh run.sh scale <nhãn> | cdn | events" >&2; exit 2 ;;
esac
