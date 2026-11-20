#!/usr/bin/env bash
# CORS có credentials cho video HLS (TF64). Chạy lại an toàn. Chạy trong CloudShell, sau setup-media-domain.sh.
# Web phát bằng hls.js (Chrome, Firefox máy tính) với withCredentials để gửi cookie CloudFront; khi đó trình duyệt
# không nhận `Access-Control-Allow-Origin: *` của Managed-SimpleCORS, nên behavior video cần policy trả đúng origin
# kèm `Access-Control-Allow-Credentials: true`. Ảnh vẫn dùng policy cũ.
# Dùng: ./setup-video-cors.sh  (đổi origin: WEB_ORIGINS="https://a,https://b" ./setup-video-cors.sh)
set -euo pipefail

BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
POLICY_NAME="${POLICY_NAME:-tripflix-video-cors}"
# Admin (màn kiểm duyệt) cũng phát HLS kèm cookie. Thêm origin thì sửa ở đây, chạy với WEB_ORIGINS khác sẽ ghi đè policy.
WEB_ORIGINS="${WEB_ORIGINS:-https://tripflix.io.vn,https://admin.tripflix.io.vn}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jq -n --arg name "$POLICY_NAME" --arg origins "$WEB_ORIGINS" '{
  Name: $name,
  Comment: "TF64: CORS có credentials cho video HLS (hls.js gửi cookie CloudFront)",
  CorsConfig: {
    AccessControlAllowOrigins: ($origins | split(",") | map(select(length > 0)) | {Quantity: length, Items: .}),
    AccessControlAllowHeaders: {Quantity: 1, Items: ["Range"]},
    AccessControlAllowMethods: {Quantity: 3, Items: ["GET", "HEAD", "OPTIONS"]},
    AccessControlAllowCredentials: true,
    AccessControlExposeHeaders: {Quantity: 2, Items: ["Content-Length", "Content-Range"]},
    AccessControlMaxAgeSec: 600,
    OriginOverride: true
  }
}' >"$TMP/policy.json"

POLICY_ID="$(aws cloudfront list-response-headers-policies --type custom \
  --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$POLICY_NAME'].ResponseHeadersPolicy.Id | [0]" \
  --output text)"
if [ "$POLICY_ID" = "None" ]; then
  POLICY_ID="$(aws cloudfront create-response-headers-policy --response-headers-policy-config "file://$TMP/policy.json" \
    --query 'ResponseHeadersPolicy.Id' --output text)"
  echo "Đã tạo response headers policy $POLICY_NAME ($POLICY_ID)"
else
  aws cloudfront get-response-headers-policy-config --id "$POLICY_ID" >"$TMP/current-policy.json"
  if [ "$(jq -S .ResponseHeadersPolicyConfig "$TMP/current-policy.json")" = "$(jq -S . "$TMP/policy.json")" ]; then
    echo "Policy $POLICY_NAME ($POLICY_ID) đã đúng"
  else
    aws cloudfront update-response-headers-policy --id "$POLICY_ID" --if-match "$(jq -r .ETag "$TMP/current-policy.json")" \
      --response-headers-policy-config "file://$TMP/policy.json" >/dev/null
    echo "Đã cập nhật policy $POLICY_NAME ($POLICY_ID)"
  fi
fi

DISTRIBUTION_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$BUCKET'] | [0].Id" --output text)"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" >"$TMP/current.json"
VIDEO_BEHAVIOR_COUNT="$(jq '[.DistributionConfig.CacheBehaviors.Items // [] | .[] | select(.PathPattern == "*.m3u8" or .PathPattern == "*.ts")] | length' "$TMP/current.json")"
if [ "$VIDEO_BEHAVIOR_COUNT" != "2" ]; then
  echo "Chưa có behavior *.m3u8 và *.ts, chạy setup-media-domain.sh trước" >&2
  exit 1
fi
jq --arg policyId "$POLICY_ID" -f "$DIR/video-cors.jq" "$TMP/current.json" >"$TMP/next.json"
if [ "$(jq -S .DistributionConfig "$TMP/current.json")" = "$(jq -S . "$TMP/next.json")" ]; then
  echo "Behavior video đã dùng policy $POLICY_NAME, không đổi gì"
  exit 0
fi
aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$(jq -r .ETag "$TMP/current.json")" \
  --distribution-config "file://$TMP/next.json" --query 'Distribution.Status' --output text
echo "Đã gắn $POLICY_NAME cho *.m3u8, *.ts. Chờ: aws cloudfront wait distribution-deployed --id $DISTRIBUTION_ID"
