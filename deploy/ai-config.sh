#!/bin/sh
# Bảo (chủ repo tripflix-ai) xem và sửa config AI trên server mà không có quyền Docker, không đọc được .env.server.
# Cài tại /opt/tripflix/ai-config.sh, chủ root. SSH key của Bảo bị ép chạy file này (deploy/SERVER.md, mục Config AI):
# lệnh gửi qua SSH chỉ được đọc thành tham số bên dưới, không bao giờ được thực thi.
#
#   get                        in deploy/.env.ai
#   set < file                 kiểm file mới, backup bản cũ, ghi, tạo lại 3 service AI; lỗi thì trả bản cũ
#   status                     trạng thái 3 service AI
#   logs <service> [số dòng]   log của ai-service, ai-summary-worker hoặc ai-label-worker (mặc định 200 dòng)
set -eu

RUN_AS="${AI_CONFIG_RUN_AS:-phongnguyen}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$RUN_AS/tripflix-be/deploy}"
BACKUP_DIR="${BACKUP_DIR:-/home/$RUN_AS/backups/env-ai}"
LOG_DIR="${LOG_DIR:-/home/$RUN_AS/deploy-logs}"
# Đợi container chạy ổn bao lâu trước khi coi là đạt: worker thiếu key thì thoát và khởi động lại trong vài giây.
SETTLE_SECONDS="${AI_CONFIG_SETTLE_SECONDS:-20}"
BACKUPS_KEPT=20
MAX_BYTES=65536
SERVICES="ai-service ai-summary-worker ai-label-worker"
# Rỗng thì service không khởi động: thiếu LLM_PROVIDER thì 2 worker dừng, giá rỗng thì ai-service lỗi (mất cả /moderate).
REQUIRED_VALUES="LLM_PROVIDER CHAT_CONTROLLER_PRICE_INPUT CHAT_CONTROLLER_PRICE_CACHED_INPUT CHAT_CONTROLLER_PRICE_OUTPUT"
# compose.server.yaml đặt các biến này trong environment, ghi đè .env.ai: đặt ở đây không có tác dụng nên từ chối cho rõ.
COMPOSE_OWNED="CORE_API_URL REDIS_URL CORS_ORIGINS FORWARDED_ALLOW_IPS SERVICE_CLIENT_ID SERVICE_CLIENT_SECRET CLASSIFIER_THREADS"

usage() {
  echo "Dùng: get | set < file | status | logs <ai-service|ai-summary-worker|ai-label-worker> [số dòng]" >&2
  exit 2
}

# Qua SSH, tham số nằm trong SSH_ORIGINAL_COMMAND. Tắt mở rộng * ? để chuỗi gửi tới chỉ bị tách theo dấu cách.
if [ "$#" -eq 0 ]; then
  set -f
  # shellcheck disable=SC2086
  set -- ${SSH_ORIGINAL_COMMAND:-}
  set +f
fi
[ "$#" -ge 1 ] || usage
ACTION="$1"
shift

# "apply" chỉ do chính script gọi sau khi đã kiểm file (biến TRIPFLIX_AI_APPLY không qua được sudo, nên SSH không gọi thẳng được).
case "$ACTION" in
  get | set | status) [ "$#" -eq 0 ] || usage ;;
  logs) [ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage ;;
  apply) [ -n "${TRIPFLIX_AI_APPLY:-}" ] && [ "$#" -eq 1 ] || usage ;;
  *) usage ;;
esac

# User của Bảo không có quyền Docker và không đọc được thư mục deploy, nên chuyển sang user đang chạy compose.
if [ "$(id -un)" != "$RUN_AS" ]; then
  exec sudo -n -H -u "$RUN_AS" "$0" "$ACTION" "$@"
fi

cd "$DEPLOY_DIR"
touch .env.web
if [ ! -f .env.ai ]; then
  echo "Server chưa có deploy/.env.ai, nhờ Phong tạo (deploy/SERVER.md, mục Config AI)" >&2
  exit 1
fi

compose() {
  docker compose -f compose.server.yaml --env-file .env.server --env-file .env.web --profile ai "$@"
}

audit() {
  mkdir -p "$LOG_DIR"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SUDO_USER:-$(id -un)}" "$*" >> "$LOG_DIR/ai-config.log"
}

# Tên biến trong file env (bỏ dòng trống, comment), mỗi dòng một tên.
names_of() {
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1"
}

# Kiểm từng dòng như compose đọc env_file. In lỗi ra stderr, trả 1 nếu có lỗi.
validate() {
  file="$1"
  if [ "$(wc -c < "$file")" -gt "$MAX_BYTES" ]; then
    echo "File lớn hơn $MAX_BYTES byte" >&2
    return 1
  fi
  if LC_ALL=C grep -q "$(printf '\r')" "$file"; then
    echo "File có ký tự CR (xuống dòng kiểu Windows): lưu lại dạng LF rồi gửi lại" >&2
    return 1
  fi
  if LC_ALL=C tr -d '\000' < "$file" | cmp -s - "$file"; then :; else
    echo "File có ký tự NUL" >&2
    return 1
  fi
  LC_ALL=C awk -v required="$REQUIRED_VALUES" -v owned="$COMPOSE_OWNED" '
    BEGIN {
      n = split(required, r, " "); for (i = 1; i <= n; i++) need[r[i]] = 1
      n = split(owned, o, " "); for (i = 1; i <= n; i++) composeOwned[o[i]] = 1
      bad = 0
    }
    /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
    {
      if ($0 !~ /^[A-Z][A-Z0-9_]*=/) { printf "Dòng %d sai dạng TÊN=giá trị (tên viết hoa, số, _): %s\n", NR, substr($0, 1, 40) > "/dev/stderr"; bad = 1; next }
      name = substr($0, 1, index($0, "=") - 1); value = substr($0, index($0, "=") + 1)
      if (length(name) > 64) { printf "Dòng %d: tên dài quá 64 ký tự\n", NR > "/dev/stderr"; bad = 1 }
      if (name ~ /^(PATH|HOME|USER|SHELL|HOSTNAME|PWD|LANG)$/ || name ~ /^(LD_|DYLD_|PYTHON)/) { printf "Dòng %d: không được đặt %s\n", NR, name > "/dev/stderr"; bad = 1 }
      if (name in composeOwned) { printf "Dòng %d: %s do compose.server.yaml đặt, sửa ở đây không có tác dụng (nhờ Phong)\n", NR, name > "/dev/stderr"; bad = 1 }
      if (name in seen) { printf "Dòng %d: %s đã có ở dòng %d\n", NR, name, seen[name] > "/dev/stderr"; bad = 1 }
      seen[name] = NR
      if (name in need && value ~ /^[[:space:]"\047]*$/) { printf "Dòng %d: %s không được để rỗng\n", NR, name > "/dev/stderr"; bad = 1 }
    }
    END {
      for (k in need) if (!(k in seen)) { printf "Thiếu %s\n", k > "/dev/stderr"; bad = 1 }
      exit bad
    }
  ' "$file"
}

recreate() {
  compose up -d --no-deps --force-recreate --wait --wait-timeout 180 $SERVICES
  sleep "$SETTLE_SECONDS"
  # --wait chỉ thấy container đang chạy ở một thời điểm; worker thoát rồi khởi động lại vẫn có lúc "running".
  failed=""
  for service in $SERVICES; do
    id="$(compose ps -q "$service")"
    state="$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$id" 2> /dev/null || echo "false 0")"
    [ "$state" = "true 0" ] || failed="$failed $service"
  done
  if [ -n "$failed" ]; then
    echo "Không chạy ổn sau ${SETTLE_SECONDS} s:$failed" >&2
    return 1
  fi
}

case "$ACTION" in
  get)
    cat .env.ai
    ;;

  status)
    compose ps $SERVICES
    ;;

  logs)
    service="$1"
    lines="${2:-200}"
    case " $SERVICES " in *" $service "*) ;; *) usage ;; esac
    case "$lines" in '' | *[!0-9]*) usage ;; esac
    [ "$lines" -le 5000 ] || lines=5000
    compose logs --no-log-prefix --tail "$lines" "$service"
    ;;

  set)
    new="$(mktemp .env.ai.new.XXXXXX)"
    chmod 600 "$new"
    head -c "$((MAX_BYTES + 1))" > "$new"
    if ! validate "$new"; then
      rm -f "$new"
      echo "Không đổi gì trên server." >&2
      exit 1
    fi
    if cmp -s "$new" .env.ai; then
      rm -f "$new"
      echo "Không có thay đổi so với bản đang chạy."
      exit 0
    fi
    # Chạy phần ghi và tạo lại service trong session riêng: SSH đứt giữa chừng thì vẫn chạy tới cuối, kể cả khi trả bản cũ.
    mkdir -p "$LOG_DIR"
    log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-ai-config.log"
    : > "$log"
    TRIPFLIX_AI_APPLY=1 setsid "$0" apply "$new" >> "$log" 2>&1 < /dev/null &
    pid=$!
    tail -n +1 -f --pid="$pid" "$log" || true
    status=0
    wait "$pid" || status=$?
    exit "$status"
    ;;

  apply)
    new="$1"
    case "$new" in .env.ai.new.*) ;; *) usage ;; esac
    [ -f "$new" ] || usage
    # Không chạy chồng với deploy-api.sh (cùng khoá) hay một lần set khác.
    exec 9> .deploy-api.lock
    if ! flock -w 300 9; then
      rm -f "$new"
      echo "Đợi 5 phút vẫn còn lần deploy khác đang chạy, không đổi gì" >&2
      exit 1
    fi
    changed="$( { names_of .env.ai; names_of "$new"; } | sort -u | while read -r name; do
      old="$(grep "^$name=" .env.ai || true)"; cur="$(grep "^$name=" "$new" || true)"
      [ "$old" = "$cur" ] || printf '%s ' "$name"
    done)"
    echo "Biến thay đổi: ${changed:-chỉ đổi comment}"
    mkdir -p "$BACKUP_DIR"
    backup="$BACKUP_DIR/env.ai-$(date -u +%Y%m%d-%H%M%S)"
    cp -p .env.ai "$backup"
    ls -1t "$BACKUP_DIR"/env.ai-* | tail -n +"$((BACKUPS_KEPT + 1))" | while read -r old; do rm -f "$old"; done
    mv "$new" .env.ai
    if recreate; then
      audit "set ok: $changed"
      echo "Xong: 3 service AI đã chạy với config mới. Bản cũ: $backup"
      exit 0
    fi
    echo "Config mới làm service lỗi, trả lại bản cũ." >&2
    cp -p "$backup" .env.ai
    audit "set lỗi, đã trả bản cũ: $changed"
    if recreate; then
      echo "Đã chạy lại bằng bản cũ. Xem lỗi: logs <service>" >&2
    else
      echo "Bản cũ cũng không chạy ổn, báo Phong ngay." >&2
    fi
    exit 1
    ;;
esac
