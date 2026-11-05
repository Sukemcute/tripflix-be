#!/bin/sh
# Deploy web lên server bằng image đã build trên GitHub. Cài tại /opt/tripflix/deploy.sh, chủ là root.
# SSH key của CI bị ép chạy file này: lệnh gửi qua SSH chỉ được dùng làm tag, không bao giờ được thực thi.
set -eu

RUN_AS="${DEPLOY_RUN_AS:-phongnguyen}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$RUN_AS/tripflix-be/deploy}"
WEB_IMAGE=ghcr.io/sukemcute/tripflix-fe/web
HEALTH_ATTEMPTS=30
IMAGES_KEPT=3

TAG="${1:-${SSH_ORIGINAL_COMMAND:-}}"
case "$TAG" in
  sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "Tag không hợp lệ, cần dạng sha-xxxxxxx" >&2
    exit 2
    ;;
esac

# User deploy không có quyền Docker và không đọc được .env.server, nên chuyển sang user đang chạy compose.
if [ "$(id -un)" != "$RUN_AS" ]; then
  exec sudo -n -H -u "$RUN_AS" "$0" "$TAG"
fi

cd "$DEPLOY_DIR"
touch .env.web

compose() {
  docker compose -f compose.server.yaml --env-file .env.server --env-file .env.web --profile gateway "$@"
}

is_web_healthy() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl -fsS -o /dev/null --max-time 10 "https://$WEB_HOST/"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}

# Chỉ đọc đúng một biến, không nạp cả file có mật khẩu vào script.
WEB_HOST="$(sed -n 's/^WEB_HOST=//p' .env.server)"
if [ -z "$WEB_HOST" ]; then
  echo "Thiếu WEB_HOST trong .env.server" >&2
  exit 1
fi

cp .env.web .env.web.prev
printf 'WEB_IMAGE=%s\nWEB_TAG=%s\n' "$WEB_IMAGE" "$TAG" > .env.web

# Pull lỗi thì web đang chạy chưa bị đụng tới, chỉ cần trả lại file tag.
if ! compose pull --quiet web; then
  mv .env.web.prev .env.web
  echo "Không pull được $WEB_IMAGE:$TAG, web giữ nguyên bản cũ" >&2
  exit 1
fi

if compose up -d --no-deps --no-build web && is_web_healthy; then
  rm -f .env.web.prev
  docker images "$WEB_IMAGE" --format '{{.Repository}}:{{.Tag}}' | tail -n +"$((IMAGES_KEPT + 1))" | while read -r old_image; do
    docker rmi "$old_image" >/dev/null 2>&1 || true
  done
  echo "Đã deploy web $TAG"
  exit 0
fi

echo "Web $TAG không đạt kiểm tra, quay về bản trước" >&2
mv .env.web.prev .env.web
compose up -d --no-deps --no-build web
is_web_healthy || echo "Bản trước cũng không đạt kiểm tra, cần xem server ngay" >&2
exit 1
