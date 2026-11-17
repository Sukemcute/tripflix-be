#!/usr/bin/env bash
# Bật hoặc tắt yêu cầu cookie ký cho video (*.m3u8, *.ts) trên CloudFront (TF82). Ảnh không bị ảnh hưởng.
# Chỉ bật khi core-api đã ký cookie và app, web đã gửi cookie; video lỗi thì tắt để quay lại như cũ.
# Dùng: ./set-video-lock.sh on | ./set-video-lock.sh off
set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "on" ] && [ "$MODE" != "off" ]; then
  echo "Dùng: $0 on|off" >&2
  exit 1
fi
BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
KEY_GROUP_NAME="${KEY_GROUP_NAME:-tripflix-playback}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

KEY_GROUP_ID="$(aws cloudfront list-key-groups \
  --query "KeyGroupList.Items[?KeyGroup.KeyGroupConfig.Name=='$KEY_GROUP_NAME'].KeyGroup.Id | [0]" --output text)"
if [ "$MODE" = "on" ] && [ "$KEY_GROUP_ID" = "None" ]; then
  echo "Chưa có key group $KEY_GROUP_NAME, chạy add-playback-key.sh trước" >&2
  exit 1
fi

DISTRIBUTION_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$BUCKET'] | [0].Id" --output text)"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" >"$TMP/current.json"
VIDEO_BEHAVIOR_COUNT="$(jq '[.DistributionConfig.CacheBehaviors.Items // [] | .[] | select(.PathPattern == "*.m3u8" or .PathPattern == "*.ts")] | length' "$TMP/current.json")"
if [ "$VIDEO_BEHAVIOR_COUNT" != "2" ]; then
  echo "Chưa có behavior *.m3u8 và *.ts, chạy setup-media-domain.sh trước" >&2
  exit 1
fi

jq --arg mode "$MODE" --arg keyGroupId "$KEY_GROUP_ID" -f "$DIR/video-lock.jq" "$TMP/current.json" >"$TMP/next.json"
if [ "$(jq -S .DistributionConfig "$TMP/current.json")" = "$(jq -S . "$TMP/next.json")" ]; then
  echo "Khoá video đã ở trạng thái $MODE, không đổi gì"
  exit 0
fi
aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$(jq -r .ETag "$TMP/current.json")" \
  --distribution-config "file://$TMP/next.json" --query 'Distribution.Status' --output text
echo "Đã đặt khoá video: $MODE. Chờ triển khai: aws cloudfront wait distribution-deployed --id $DISTRIBUTION_ID"
