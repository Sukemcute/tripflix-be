#!/bin/sh
# Deploy core-api hoặc notification-service lên server bằng image đã build trên GitHub.
# Cài tại /opt/tripflix/deploy-api.sh, chủ là root. SSH key CI của repo tripflix-be bị ép chạy file này:
# lệnh gửi qua SSH chỉ được đọc thành "<app> sha-xxxxxxx", không bao giờ được thực thi.
#
# Thứ tự: ghi tag mới vào .env.server, pull image, backup database của app, chạy app (core-api migrate trước),
# kiểm tra. Lỗi thì trả lại .env.server và chạy lại image cũ, không chạy lại migrate.
# Chạy tay trên server: /opt/tripflix/deploy-api.sh core-api sha-xxxxxxx
set -eu

RUN_AS="${DEPLOY_RUN_AS:-phongnguyen}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$RUN_AS/tripflix-be/deploy}"
BACKUP_DIR="${BACKUP_DIR:-/home/$RUN_AS/backups}"
LOG_DIR="${LOG_DIR:-/home/$RUN_AS/deploy-logs}"
IMAGE_PREFIX=ghcr.io/sukemcute/tripflix-be
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_SLEEP="${HEALTH_SLEEP:-5}"
IMAGES_KEPT=3
BACKUPS_KEPT=20
LOGS_KEPT=50

# Qua SSH, tham số nằm trong SSH_ORIGINAL_COMMAND. Tắt mở rộng * ? để chuỗi gửi tới chỉ bị tách theo dấu cách.
if [ "$#" -eq 0 ]; then
  set -f
  # shellcheck disable=SC2086
  set -- ${SSH_ORIGINAL_COMMAND:-}
  set +f
fi
if [ "$#" -ne 2 ]; then
  echo "Cần đúng hai tham số: <core-api|notification-service> sha-xxxxxxx" >&2
  exit 2
fi
APP="$1"
TAG="$2"

case "$APP" in
  core-api)
    TAG_VAR=CORE_API_TAG
    PROFILE=api
    DB=core
    ;;
  notification-service)
    TAG_VAR=NOTIFICATION_TAG
    PROFILE=mail
    DB=notification
    ;;
  *)
    echo "App không hợp lệ: chỉ core-api hoặc notification-service" >&2
    exit 2
    ;;
esac
case "$TAG" in
  sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "Tag không hợp lệ, cần dạng sha-xxxxxxx" >&2
    exit 2
    ;;
esac

# User deploy không có quyền Docker và không đọc được .env.server, nên chuyển sang user đang chạy compose.
if [ "$(id -un)" != "$RUN_AS" ]; then
  exec sudo -n -H -u "$RUN_AS" "$0" "$APP" "$TAG"
fi

# Chạy phần deploy trong session riêng, ghi log ra file, rồi đọc log trả về SSH. GitHub huỷ lần chạy
# (có merge mới) hay mạng rớt thì SSH đứt, nhưng deploy vẫn chạy đến cuối: không bao giờ dừng giữa lúc migrate.
if [ -z "${TRIPFLIX_DEPLOY_DETACHED:-}" ]; then
  mkdir -p "$LOG_DIR"
  log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-$APP-$TAG.log"
  : > "$log"
  TRIPFLIX_DEPLOY_DETACHED=1 setsid "$0" "$APP" "$TAG" >> "$log" 2>&1 < /dev/null &
  pid=$!
  tail -n +1 -f --pid="$pid" "$log" || true
  status=0
  wait "$pid" || status=$?
  ls -1t "$LOG_DIR"/*.log 2> /dev/null | tail -n +"$((LOGS_KEPT + 1))" | while read -r old; do rm -f "$old"; done
  exit "$status"
fi

cd "$DEPLOY_DIR"
touch .env.web

# Hai lần deploy (merge liên tiếp, hay chạy tay cùng lúc với CI) không chạy chồng nhau.
exec 9> .deploy-api.lock
if ! flock -w 900 9; then
  echo "Đợi 15 phút vẫn còn lần deploy khác đang chạy, dừng" >&2
  exit 1
fi

compose() {
  docker compose -f compose.server.yaml --env-file .env.server --env-file .env.web --profile "$PROFILE" "$@"
}

# Chỉ đọc đúng một biến, không nạp cả file có mật khẩu vào script.
# Đọc như compose: dòng cuối được dùng; bỏ comment cuối dòng, dấu nháy, khoảng trắng và CR.
read_var() {
  sed -n "s/^$1=//p" .env.server | tail -n 1 | sed 's/[[:space:]]#.*$//' | tr -d "\"' \t\r"
}

# Bỏ mọi dòng cũ của biến rồi thêm dòng mới. Ghi đè bằng cat để file giữ nguyên chủ và quyền.
set_var() {
  tmp="$(mktemp .env.server.XXXXXX)"
  grep -v "^$1=" .env.server > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env.server
  rm -f "$tmp"
}

restore_env() {
  cat .env.server.prev > .env.server
  rm -f .env.server.prev
}

API_HOST=""
if [ "$APP" = core-api ]; then
  API_HOST="$(read_var API_HOST)"
  # Kiểm tra trước khi đụng tới app, để cấu hình sai không làm khởi động lại container.
  case "$API_HOST" in
    '' | *[!a-zA-Z0-9.-]*)
      echo "API_HOST trong .env.server không hợp lệ" >&2
      exit 1
      ;;
  esac
fi

# Healthcheck của container (up --wait) chỉ biết app trả lời trong máy. Với core-api kiểm thêm qua HTTPS
# công khai, để bắt cả lỗi gateway và lỗi đọc database của API feed.
is_public_ok() {
  [ "$APP" = core-api ] || return 0
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl -fsS -o /dev/null --max-time 10 "https://$API_HOST/api/v1/feed"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep "$HEALTH_SLEEP"
  done
  return 1
}

prev_tag="$(read_var "$TAG_VAR")"
cp -p .env.server .env.server.prev
set_var "$TAG_VAR" "$TAG"

# App chưa từng bật trên server (ví dụ chưa có SMTP cho notification-service): chỉ ghi tag, không tự bật.
if [ -z "$(compose ps -q --status running "$APP")" ]; then
  rm -f .env.server.prev
  echo "$APP chưa chạy trên server: đã ghi $TAG_VAR=$TAG, không khởi động"
  exit 0
fi

# Pull lỗi thì app đang chạy chưa bị đụng tới, chỉ cần trả lại .env.server.
if ! compose pull --quiet "$APP"; then
  restore_env
  echo "Không pull được $IMAGE_PREFIX/$APP:$TAG, $APP giữ nguyên bản ${prev_tag:-cũ}" >&2
  exit 1
fi

# Backup trước khi migrate: quay về image cũ không hoàn tác được database, chỉ backup làm được.
# File .part chỉ đổi tên khi pg_dump xong và có dữ liệu, nên file .dump luôn là bản đầy đủ.
mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/auto-$DB-$(date +%Y%m%d-%H%M%S)-before-$TAG.dump"
if ! compose exec -T postgres pg_dump -U postgres -Fc "$DB" > "$backup.part" || [ ! -s "$backup.part" ]; then
  rm -f "$backup.part"
  restore_env
  echo "Backup database $DB lỗi, không deploy. $APP giữ nguyên bản ${prev_tag:-cũ}" >&2
  exit 1
fi
mv "$backup.part" "$backup"
echo "Đã backup database $DB: $backup ($(du -h "$backup" | cut -f1))"
ls -1t "$BACKUP_DIR"/auto-"$DB"-*.dump 2> /dev/null | tail -n +"$((BACKUPS_KEPT + 1))" | while read -r old; do rm -f "$old"; done

echo "Lên $APP: ${prev_tag:-không rõ} -> $TAG"
# core-api phụ thuộc migrate (service_completed_successfully): migrate lỗi thì core-api cũ vẫn chạy, up báo lỗi.
if compose up -d --no-build --wait "$APP" && is_public_ok; then
  rm -f .env.server.prev
  docker images "$IMAGE_PREFIX/$APP" --format '{{.Repository}}:{{.Tag}}' | tail -n +"$((IMAGES_KEPT + 1))" | while read -r old_image; do
    docker rmi "$old_image" > /dev/null 2>&1 || true
  done
  echo "Đã deploy $APP $TAG"
  exit 0
fi

echo "$APP $TAG không đạt kiểm tra, quay về ${prev_tag:-bản trước}" >&2
[ "$APP" = core-api ] && compose logs --no-color --tail 30 migrate >&2 || true
compose logs --no-color --tail 30 "$APP" >&2 || true
restore_env
# --no-deps: không chạy lại migrate bằng image cũ.
if compose up -d --no-build --no-deps --wait "$APP" && is_public_ok; then
  echo "Đã quay về $APP ${prev_tag:-bản trước}" >&2
else
  echo "Bản trước cũng không đạt kiểm tra, cần xem server ngay" >&2
fi
if [ "$APP" = core-api ]; then
  echo "Nếu migration của $TAG đã chạy và bản cũ lỗi vì database: khôi phục từ $backup (deploy/SERVER.md, mục Khôi phục database)" >&2
fi
exit 1
