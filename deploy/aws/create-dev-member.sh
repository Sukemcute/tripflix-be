#!/usr/bin/env bash
# Tạo IAM user chỉ đọc, ghi được thư mục dev/<tên>/. Không tạo access key, để key không hiện trên màn hình dùng chung.
# Dùng: ./create-dev-member.sh phong
set -euo pipefail

DEV_NAME="${1:-}"
BUCKET="${S3_MEDIA_BUCKET:-tripflix-media-dev}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "$DEV_NAME" in
  trang | duy | dung | phong | bao | thang | thanh) ;;
  *)
    echo "Dùng: $0 <trang|duy|dung|phong|bao|thang|thanh>" >&2
    exit 1
    ;;
esac

USER_NAME="tripflix-dev-$DEV_NAME"
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "User $USER_NAME đã có"
else
  aws iam create-user --user-name "$USER_NAME" >/dev/null
  echo "Đã tạo user $USER_NAME"
fi

sed -e "s|@BUCKET@|$BUCKET|g" -e "s|@DEV_NAME@|$DEV_NAME|g" \
  "$DIR/iam-dev-member-policy.template.json" >"$TMP/policy.json"
aws iam put-user-policy --user-name "$USER_NAME" --policy-name tripflix-media-dev \
  --policy-document "file://$TMP/policy.json"
echo "Đã gán quyền dev/$DEV_NAME/*. Tạo access key cho $USER_NAME trong AWS Console."
