#!/usr/bin/env bash
# TF99: bật/tắt cụm nhiều process core-api sau nginx để đo tải (cấu hình a và b).
#   bash tools/bench/comments/cluster.sh up a|b
#   bash tools/bench/comments/cluster.sh down
# Cấu hình a: 1 process core-api (APP_ROLE=all, cổng 3101).
# Cấu hình b: 2 process api (APP_ROLE=api, cổng 3101, 3102) + 1 process worker (APP_ROLE=worker).
# Cả hai cấu hình đều đứng sau container nginx tf99-lb ở cổng 3000.
# Ghi thông tin cụm vào out/cluster-<tag>.txt: tên,vai trò,winpid,cổng,đường dẫn probe.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# Docker Desktop và Node trên Windows cần đường dẫn kiểu D:/...; Linux/macOS dùng đường dẫn thường.
HOST_DIR="$(cd "$DIR" && (pwd -W 2>/dev/null || pwd))"
REPO_DIR="$(cd "$DIR/../../.." && pwd)"
CORE_DIR="$REPO_DIR/apps/core-api"
OUT="$DIR/out"
export MSYS_NO_PATHCONV=1
mkdir -p "$OUT"

SPAWNED_PIDS=()

stop_winpid() {
  local winpid="$1"
  [ -n "$winpid" ] || return 0
  powershell.exe -NoProfile -Command "Stop-Process -Id $winpid -Force" 2>/dev/null || true
}

is_winpid_alive() {
  local winpid="$1"
  [ -n "$winpid" ] || return 1
  powershell.exe -NoProfile -Command "Get-Process -Id $winpid -ErrorAction Stop" > /dev/null 2>&1
}

http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true
}

do_down() {
  local f name role winpid port probe_file
  shopt -s nullglob
  for f in "$OUT"/cluster-*.txt; do
    while IFS=',' read -r name role winpid port probe_file || [ -n "$name" ]; do
      stop_winpid "$winpid"
    done < "$f"
    # Giữ file cụm sau khi tắt: analyze-ab.mjs cần nó để tìm file probe của từng process.
  done
  shopt -u nullglob
  docker rm -f tf99-lb > /dev/null 2>&1 || true
}

# Bật một process core-api ở nền, lấy winpid của Windows và ghi vào file cluster-<tag>.txt.
start_proc() {
  local tag="$1" name="$2" role="$3" port="$4" cluster_file="$5"
  local probe_file="$HOST_DIR/out/probe-$tag-$name.jsonl"
  local log_file="$OUT/core-$tag-$name.log"
  local pid winpid

  pushd "$CORE_DIR" > /dev/null
  if [ -n "$port" ]; then
    LOG_LEVEL=info APP_ROLE="$role" PORT="$port" BENCH_PROBE_FILE="$probe_file" \
      NODE_OPTIONS="--import file:///$HOST_DIR/probe.mjs" \
      nohup node dist/main.js > "$log_file" 2>&1 < /dev/null &
  else
    # Worker không mở cổng HTTP: bỏ PORT để tránh thừa biến môi trường từ shell gọi vào.
    unset PORT
    LOG_LEVEL=info APP_ROLE="$role" BENCH_PROBE_FILE="$probe_file" \
      NODE_OPTIONS="--import file:///$HOST_DIR/probe.mjs" \
      nohup node dist/main.js > "$log_file" 2>&1 < /dev/null &
  fi
  pid=$!
  popd > /dev/null
  SPAWNED_PIDS+=("$pid")

  # /proc/$!/winpid là PID của lớp nohup trung gian, không phải node.exe: lấy PID thật từ log,
  # pino in "(core-api/<pid>)" ở mọi dòng ngay khi app khởi động.
  local tries=0
  winpid=""
  while [ "$tries" -lt 120 ]; do
    winpid="$(sed 's/\x1b\[[0-9;]*m//g' "$log_file" 2>/dev/null | grep -oE 'core-api/[0-9]+' | head -1 | cut -d/ -f2 || true)"
    [ -n "$winpid" ] && break
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Process $name thoát sớm. Xem $log_file" >&2
      exit 1
    fi
    sleep 0.5
    tries=$((tries + 1))
  done
  if [ -z "$winpid" ]; then
    echo "Không đọc được PID của $name trong log sau 60 s. Xem $log_file" >&2
    exit 1
  fi

  printf '%s,%s,%s,%s,%s\n' "$name" "$role" "$winpid" "$port" "$probe_file" >> "$cluster_file"
}

write_nginx_conf() {
  local conf_file="$1"
  shift
  local upstream_servers="" port
  for port in "$@"; do
    upstream_servers+="    server host.docker.internal:$port;"$'\n'
  done

  cat > "$conf_file" <<EOF
worker_processes auto;

events {
  worker_connections 8192;
}

http {
  access_log off;

  upstream core_api {
${upstream_servers}    keepalive 256;
  }

  server {
    listen 3000;

    location / {
      proxy_pass http://core_api;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host \$http_host;
      proxy_set_header Authorization \$http_authorization;
      proxy_read_timeout 60s;
    }
  }
}
EOF
}

wait_ready() {
  local tag="$1" cluster_file="$2"
  shift 2
  local pending_ports=("$@")
  local deadline=$(( $(date +%s) + 300 ))
  local next_report=$(( $(date +%s) + 10 ))
  local lb_ready=0

  while :; do
    local now
    now="$(date +%s)"

    # Phát hiện sớm nếu process vừa bật đã tự thoát (lỗi cấu hình, thiếu DB/Redis...).
    local pid
    for pid in "${SPAWNED_PIDS[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "Process core-api thoát sớm (pid $pid). Xem log trong $OUT/core-$tag-*.log." >&2
        return 1
      fi
    done

    local still_pending=() port
    if [ "${#pending_ports[@]}" -gt 0 ]; then
      for port in "${pending_ports[@]}"; do
        if [ "$(http_status "http://localhost:$port/api/v1/feed?limit=1")" = "200" ]; then
          echo "Cổng $port sẵn sàng (200)."
        else
          still_pending+=("$port")
        fi
      done
    fi
    if [ "${#still_pending[@]}" -gt 0 ]; then
      pending_ports=("${still_pending[@]}")
    else
      pending_ports=()
    fi

    if [ "${#pending_ports[@]}" -eq 0 ] && [ "$lb_ready" -eq 0 ]; then
      if [ "$(http_status "http://localhost:3000/api/v1/feed?limit=1")" = "200" ]; then
        echo "Nginx http://localhost:3000 sẵn sàng (200)."
        lb_ready=1
      fi
    fi

    if [ "${#pending_ports[@]}" -eq 0 ] && [ "$lb_ready" -eq 1 ]; then
      break
    fi

    if [ "$now" -ge "$deadline" ]; then
      echo "Hết thời gian chờ 300s (cổng còn chờ: ${pending_ports[*]-none}, nginx=$lb_ready)." >&2
      return 1
    fi

    if [ "$now" -ge "$next_report" ]; then
      echo "Đang chờ cụm $tag sẵn sàng (còn $((deadline - now))s)..."
      next_report=$((now + 10))
    fi
    sleep 2
  done

  if [ "$tag" = "b" ]; then
    local worker_log="$OUT/core-b-worker.log"
    local worker_winpid
    worker_winpid="$(awk -F',' '$1 == "worker" { print $3; exit }' "$cluster_file")"
    local worker_deadline=$(( $(date +%s) + 30 ))
    [ "$worker_deadline" -le "$deadline" ] || worker_deadline="$deadline"
    while :; do
      if [ -f "$worker_log" ] && grep -qE "core-api chạy vai trò worker|vai trò worker" "$worker_log"; then
        echo "Worker sẵn sàng."
        break
      fi
      if ! is_winpid_alive "$worker_winpid"; then
        echo "Worker thoát sớm (winpid $worker_winpid). Xem $worker_log." >&2
        return 1
      fi
      local now
      now="$(date +%s)"
      if [ "$now" -ge "$worker_deadline" ]; then
        echo "Worker còn sống (winpid $worker_winpid), chưa thấy dòng log vai trò worker."
        break
      fi
      sleep 2
    done
  fi
}

do_up() {
  local tag="${1:-}"
  case "$tag" in
    a|b) ;;
    *) echo "Cần chỉ định cấu hình a hoặc b: $0 up a|b" >&2; exit 1 ;;
  esac

  if [ ! -f "$CORE_DIR/dist/main.js" ]; then
    echo "Chưa có $CORE_DIR/dist/main.js. Hãy build core-api trước." >&2
    exit 1
  fi

  # Dọn cụm cũ trước để không đụng cổng 3000/3101/3102.
  do_down

  # Không đặt AUTH_JWT_PRIVATE_KEY thì mỗi process tự sinh khoá tạm riêng: token do process này ký thì process kia
  # từ chối (401), lượt gửi lỗi một nửa. Dùng chung một khoá chỉ cho bài đo, tạo bằng:
  #   (cd apps/core-api && node dist/cli/keygen.js) > tools/bench/comments/out/bench-keys.env   (out/ không commit)
  if [ -f "$OUT/bench-keys.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$OUT/bench-keys.env"
    set +a
  elif [ "$tag" = "b" ]; then
    echo "Thiếu $OUT/bench-keys.env: nhiều process sẽ không nhận token của nhau. Tạo theo hướng dẫn trong cluster.sh." >&2
    exit 1
  fi

  local cluster_file="$OUT/cluster-$tag.txt"
  local nginx_conf="$OUT/nginx-$tag.conf"
  local host_nginx_conf="$HOST_DIR/out/nginx-$tag.conf"
  : > "$cluster_file"

  local api_ports=()
  if [ "$tag" = "a" ]; then
    start_proc "$tag" all all 3101 "$cluster_file"
    api_ports=(3101)
  else
    start_proc "$tag" api1 api 3101 "$cluster_file"
    start_proc "$tag" api2 api 3102 "$cluster_file"
    start_proc "$tag" worker worker "" "$cluster_file"
    api_ports=(3101 3102)
  fi

  write_nginx_conf "$nginx_conf" "${api_ports[@]}"
  docker run -d --name tf99-lb -p 3000:3000 -v "$host_nginx_conf:/etc/nginx/nginx.conf:ro" nginx:alpine > /dev/null

  wait_ready "$tag" "$cluster_file" "${api_ports[@]}"
  echo "Cụm $tag đã sẵn sàng tại http://localhost:3000 ($cluster_file)."
}

CMD="${1:-}"
case "$CMD" in
  up) do_up "${2:-}" ;;
  down) do_down ;;
  *) echo "Cách dùng: $0 up a|b | $0 down" >&2; exit 1 ;;
esac
