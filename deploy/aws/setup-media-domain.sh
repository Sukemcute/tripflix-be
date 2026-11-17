#!/usr/bin/env bash
# Gắn tên miền riêng cho CDN media và tách behavior cho video HLS (TF82). Chạy lại an toàn.
# Cần chứng chỉ ACM ở us-east-1 đã ISSUED cho MEDIA_DOMAIN (README mục "Tên miền và khoá video").
# Chạy trong AWS CloudShell, sau setup-dev-media.sh. Dùng: ./setup-media-domain.sh
set -euo pipefail

BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
MEDIA_DOMAIN="${MEDIA_DOMAIN:-media.tripflix.io.vn}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# CloudFront chỉ nhận chứng chỉ ở us-east-1, dù bucket ở vùng khác.
CERT_ARN="${CERT_ARN:-$(aws acm list-certificates --region us-east-1 --certificate-statuses ISSUED \
  --query "CertificateSummaryList[?DomainName=='$MEDIA_DOMAIN'].CertificateArn | [0]" --output text)}"
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  echo "Chưa có chứng chỉ ISSUED cho $MEDIA_DOMAIN ở us-east-1" >&2
  exit 1
fi

DISTRIBUTION_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$BUCKET'] | [0].Id" --output text)"
if [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "Chưa có CloudFront cho $BUCKET, chạy setup-dev-media.sh trước" >&2
  exit 1
fi

aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" >"$TMP/current.json"
jq --arg domain "$MEDIA_DOMAIN" --arg cert "$CERT_ARN" -f "$DIR/media-domain.jq" "$TMP/current.json" >"$TMP/next.json"
if [ "$(jq -S .DistributionConfig "$TMP/current.json")" = "$(jq -S . "$TMP/next.json")" ]; then
  echo "CloudFront $DISTRIBUTION_ID đã đúng cấu hình, không đổi gì"
  exit 0
fi

# Bản cũ để quay lại: update-distribution với .DistributionConfig của file này và ETag mới nhất.
BACKUP="distribution-$DISTRIBUTION_ID-$(date +%Y%m%d-%H%M%S).json"
cp "$TMP/current.json" "$BACKUP"
aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$(jq -r .ETag "$TMP/current.json")" \
  --distribution-config "file://$TMP/next.json" --query 'Distribution.Status' --output text
echo "Đã gắn $MEDIA_DOMAIN và behavior *.m3u8, *.ts cho $DISTRIBUTION_ID (bản cũ: $BACKUP)"
echo "Chờ triển khai: aws cloudfront wait distribution-deployed --id $DISTRIBUTION_ID"
echo "Trỏ DNS: CNAME $MEDIA_DOMAIN -> $(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query 'Distribution.DomainName' --output text)"
