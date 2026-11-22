#!/bin/sh
# Deploy web hoặc admin lên server bằng image đã build trên GitHub. Cài tại /opt/tripflix/deploy.sh, chủ là root.
# SSH key của CI bị ép chạy file này: lệnh gửi qua SSH chỉ được dùng làm tên app và tag, không bao giờ được thực thi.
# Dạng lệnh: "sha-xxxxxxx" (web, như bản cũ) hoặc "admin sha-xxxxxxx".
set -eu

RUN_AS="${DEPLOY_RUN_AS:-phongnguyen}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$RUN_AS/tripflix-be/deploy}"
HEALTH_ATTEMPTS=30
IMAGES_KEPT=3

if [ "$#" -eq 0 ]; then
  # Không đặt trong dấu nháy để tách thành từng từ; tắt glob để ký tự * hay ? không được mở rộng.
  set -f
  # shellcheck disable=SC2086
  set -- ${SSH_ORIGINAL_COMMAND:-}
  set +f
fi
case "$#:${1:-}" in
  1:*) APP=web ;;
  2:web | 2:admin)
    APP="$1"
    shift
    ;;
  *)
    echo "Lệnh không hợp lệ, cần dạng [web|admin] sha-xxxxxxx" >&2
    exit 2
    ;;
esac
TAG="$1"
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

case "$APP" in
  web)
    IMAGE=ghcr.io/sukemcute/tripflix-fe/web
    VAR=WEB
    HOST_VAR=WEB_HOST
    HEALTH_PATH=/
    ;;
  admin)
    IMAGE=ghcr.io/sukemcute/tripflix-fe/admin
    VAR=ADMIN
    HOST_VAR=ADMIN_HOST
    HEALTH_PATH=/healthz
    ;;
esac

cd "$DEPLOY_DIR"
touch .env.web

compose() {
  docker compose -f compose.server.yaml --env-file .env.server --env-file .env.web --profile gateway --profile admin "$@"
}

is_healthy() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl -fsS -o /dev/null --max-time 10 "https://$HOST$HEALTH_PATH"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}

# Chỉ đọc đúng một biến, không nạp cả file có mật khẩu vào script.
# Đọc như compose: dòng cuối được dùng; bỏ comment cuối dòng, dấu nháy, khoảng trắng và CR.
read_env() {
  sed -n "s/^$1=//p" .env.server | tail -n 1 | sed 's/[[:space:]]#.*$//' | tr -d "\"' \t\r"
}
HOST="$(read_env "$HOST_VAR")"
# Như compose.server.yaml: chưa đặt ADMIN_HOST thì dùng admin.<WEB_HOST>.
if [ "$APP" = admin ] && [ -z "$HOST" ]; then
  HOST="admin.$(read_env WEB_HOST)"
fi
# Kiểm tra trước khi đụng tới container, để cấu hình sai không làm khởi động lại container.
case "$HOST" in
  '' | admin. | *[!a-zA-Z0-9.-]*)
    echo "$HOST_VAR trong .env.server không hợp lệ" >&2
    exit 1
    ;;
esac

# .env.web giữ tag của cả web và admin: chỉ thay 2 dòng của app này, giữ nguyên dòng của app kia.
cp .env.web .env.web.prev
{
  grep -v -e "^${VAR}_IMAGE=" -e "^${VAR}_TAG=" .env.web.prev || true
  printf '%s_IMAGE=%s\n%s_TAG=%s\n' "$VAR" "$IMAGE" "$VAR" "$TAG"
} > .env.web.next
mv .env.web.next .env.web

# Pull lỗi thì app đang chạy chưa bị đụng tới, chỉ cần trả lại file tag.
if ! compose pull --quiet "$APP"; then
  mv .env.web.prev .env.web
  echo "Không pull được $IMAGE:$TAG, $APP giữ nguyên bản cũ" >&2
  exit 1
fi

if compose up -d --no-deps --no-build "$APP" && is_healthy; then
  rm -f .env.web.prev
  docker images "$IMAGE" --format '{{.Repository}}:{{.Tag}}' | tail -n +"$((IMAGES_KEPT + 1))" | while read -r old_image; do
    docker rmi "$old_image" >/dev/null 2>&1 || true
  done
  echo "Đã deploy $APP $TAG"
  exit 0
fi

echo "$APP $TAG không đạt kiểm tra, quay về bản trước" >&2
mv .env.web.prev .env.web
if grep -q "^${VAR}_TAG=" .env.web; then
  compose up -d --no-deps --no-build "$APP"
  is_healthy || echo "Bản trước cũng không đạt kiểm tra, cần xem server ngay" >&2
else
  # Lần deploy đầu của app này: không có bản trước để quay về, dừng container lỗi.
  compose stop "$APP"
fi
exit 1
