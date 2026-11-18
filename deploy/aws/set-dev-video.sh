#!/usr/bin/env bash
# Mở video của máy dev (`dev/*`) khỏi khoá cookie ký (TF82), để core-api chạy local không có khoá CloudFront vẫn phát
# được video. Video staging (`staging/*`) vẫn khoá. Chạy lại an toàn, kể cả trên distribution đang có `dev/*` bản cũ.
# Chạy trong CloudShell.
# Không cấp khoá riêng cho dev: key group tin mọi khoá như nhau, cầm khoá dev là ký được cookie xem cả video staging.
# Dùng: ./set-dev-video.sh open | ./set-dev-video.sh close
set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "open" ] && [ "$MODE" != "close" ]; then
  echo "Dùng: $0 open|close" >&2
  exit 1
fi
BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DISTRIBUTION_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$BUCKET'] | [0].Id" --output text)"
if [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "Chưa có CloudFront cho $BUCKET, chạy setup-dev-media.sh trước" >&2
  exit 1
fi
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" >"$TMP/current.json"
jq --arg mode "$MODE" -f "$DIR/dev-video.jq" "$TMP/current.json" >"$TMP/next.json"
if [ "$(jq -S .DistributionConfig "$TMP/current.json")" = "$(jq -S . "$TMP/next.json")" ]; then
  echo "Video dev đã ở trạng thái $MODE, không đổi gì"
  exit 0
fi
aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$(jq -r .ETag "$TMP/current.json")" \
  --distribution-config "file://$TMP/next.json" --query 'Distribution.Status' --output text
echo "Đã đặt video dev: $MODE. Chờ triển khai: aws cloudfront wait distribution-deployed --id $DISTRIBUTION_ID"
