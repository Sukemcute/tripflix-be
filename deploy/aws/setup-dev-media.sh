#!/usr/bin/env bash
# Tạo bucket media dev và CloudFront. Chạy lại an toàn: phần nào đã có thì bỏ qua.
# Cần quyền quản trị S3 và CloudFront, nên chạy trong AWS CloudShell. Dùng: ./setup-dev-media.sh
set -euo pipefail

BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
REGION="${AWS_REGION:-ap-southeast-2}"
OAC_NAME="$BUCKET-oac"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Tìm chính sách có sẵn của AWS theo tên, vì không có API nào bảo đảm ID ghi cứng còn đúng.
require_policy_id() {
  local label="$1" policy_id="$2"
  if [ -z "$policy_id" ] || [ "$policy_id" = "None" ]; then
    echo "Không tìm thấy chính sách CloudFront $label" >&2
    exit 1
  fi
  echo "$policy_id"
}

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket $BUCKET đã có"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  echo "Đã tạo bucket $BUCKET"
fi

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$DIR/cors.json"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "file://$DIR/lifecycle.json" >/dev/null
echo "Đã đặt chặn công khai, CORS, lifecycle"

OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" --output text)"
if [ "$OAC_ID" = "None" ]; then
  OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=$OAC_NAME,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query 'OriginAccessControl.Id' --output text)"
  echo "Đã tạo OAC $OAC_ID"
fi

# Gán vào biến trước: lệnh nằm trong <<< thì lỗi của nó không làm script dừng dù có set -e.
DISTRIBUTION_INFO="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$BUCKET'] | [0].[Id,DomainName]" --output text)"
read -r DISTRIBUTION_ID CDN_DOMAIN <<<"$DISTRIBUTION_INFO"
if [ "$DISTRIBUTION_ID" = "None" ]; then
  CACHE_POLICY_ID="$(aws cloudfront list-cache-policies --type managed \
    --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingOptimized'].CachePolicy.Id | [0]" \
    --output text)"
  ORIGIN_REQUEST_POLICY_ID="$(aws cloudfront list-origin-request-policies --type managed \
    --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-CORS-S3Origin'].OriginRequestPolicy.Id | [0]" \
    --output text)"
  RESPONSE_HEADERS_POLICY_ID="$(aws cloudfront list-response-headers-policies --type managed \
    --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='Managed-SimpleCORS'].ResponseHeadersPolicy.Id | [0]" \
    --output text)"
  CACHE_POLICY_ID="$(require_policy_id Managed-CachingOptimized "$CACHE_POLICY_ID")"
  ORIGIN_REQUEST_POLICY_ID="$(require_policy_id Managed-CORS-S3Origin "$ORIGIN_REQUEST_POLICY_ID")"
  RESPONSE_HEADERS_POLICY_ID="$(require_policy_id Managed-SimpleCORS "$RESPONSE_HEADERS_POLICY_ID")"

  sed -e "s|@BUCKET@|$BUCKET|g" -e "s|@REGION@|$REGION|g" -e "s|@OAC_ID@|$OAC_ID|g" \
    -e "s|@CALLER_REFERENCE@|$BUCKET-$(date +%s)|g" \
    -e "s|@CACHE_POLICY_ID@|$CACHE_POLICY_ID|g" \
    -e "s|@ORIGIN_REQUEST_POLICY_ID@|$ORIGIN_REQUEST_POLICY_ID|g" \
    -e "s|@RESPONSE_HEADERS_POLICY_ID@|$RESPONSE_HEADERS_POLICY_ID|g" \
    "$DIR/cloudfront-distribution.template.json" >"$TMP/distribution.json"
  DISTRIBUTION_INFO="$(aws cloudfront create-distribution \
    --distribution-config "file://$TMP/distribution.json" \
    --query 'Distribution.[Id,DomainName]' --output text)"
  read -r DISTRIBUTION_ID CDN_DOMAIN <<<"$DISTRIBUTION_INFO"
  echo "Đã tạo CloudFront $DISTRIBUTION_ID, cần khoảng vài phút để triển khai"
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
sed -e "s|@BUCKET@|$BUCKET|g" \
  -e "s|@DISTRIBUTION_ARN@|arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DISTRIBUTION_ID|g" \
  "$DIR/bucket-policy.template.json" >"$TMP/bucket-policy.json"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$TMP/bucket-policy.json"
echo "Đã cho CloudFront đọc dev/*/videos/* và dev/*/images/*"

echo
echo "Ghi vào deploy/.env của từng người:"
echo "AWS_REGION=$REGION"
echo "S3_MEDIA_BUCKET=$BUCKET"
echo "MEDIA_CDN_URL=https://$CDN_DOMAIN"
