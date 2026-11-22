#!/bin/bash
# Đo GET /api/recommendations/reels của discovery (web Reels từ TF108), 4 mode, trang đầu và trang 2.
# Không có cache trang đầu, nên không cần xoá Redis. Mỗi lượt gọi có đăng nhập sẽ ghi "đã gợi ý" vào Redis.
set -euo pipefail
API=${API:-http://localhost:3000}
N=${N:-20}
EMAIL=${EMAIL:-usr_00001@sim.tripflix.local}
PASSWORD=${SEED_PASSWORD:-tripflix-dev-123}   # mặc định của deploy/compose.yaml, chỉ dùng cho local

TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("accessToken") or d.get("tokens",{}).get("accessToken",""))')
[ -z "$TOKEN" ] && { echo "Đăng nhập $EMAIL thất bại"; exit 1; }

stats() { sort -n | awk '{a[NR]=$1*1000} END {i=int(NR*0.5)+1; if(i>NR)i=NR; j=int(NR*0.95); if(j<1)j=1; printf "p50 %4.0f ms · p95 %4.0f ms\n", a[i], a[j]}'; }

measure() { # nhãn url auth|guest
  local h=(); [ "$3" = auth ] && h=(-H "authorization: Bearer $TOKEN")
  curl -s "${h[@]}" "$2" >/dev/null   # bỏ lượt đầu
  for _ in $(seq "$N"); do curl -s -o /dev/null -w '%{time_total}\n' "${h[@]}" "$2"; done | { printf '%-30s ' "$1"; stats; }
}

page2() { # nhãn url auth|guest
  local h=(); [ "$3" = auth ] && h=(-H "authorization: Bearer $TOKEN")
  local cur; cur=$(curl -s "${h[@]}" "$2" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("nextCursor") or "")')
  measure "$1" "$2&cursor=$cur" "$3"
}

for mode in for_you trending has_plan recent; do
  url="$API/api/recommendations/reels?mode=$mode&limit=20"
  measure "$mode trang đầu (user)" "$url" auth
  page2   "$mode trang 2 (user)"   "$url" auth
done
measure "trending trang đầu (khách)" "$API/api/recommendations/reels?mode=trending&limit=20" guest
