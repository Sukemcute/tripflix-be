#!/usr/bin/env bash
# Đưa public key ký cookie video lên CloudFront và thêm vào key group (TF82). Chạy lại an toàn.
# Dùng cả lúc tạo lần đầu và lúc xoay khoá: key group giữ được tối đa 5 khoá, khoá cũ vẫn hợp lệ cho tới khi gỡ.
# Chỉ đưa public key; khoá riêng nằm trên server (README mục "Tên miền và khoá video").
# Dùng: ./add-playback-key.sh <public-key.pem>
set -euo pipefail

KEY_GROUP_NAME="${KEY_GROUP_NAME:-tripflix-playback}"
PUBLIC_KEY_FILE="${1:?Cần đường dẫn public key, ví dụ ./add-playback-key.sh cloudfront-playback.pub.pem}"
if ! grep -q 'BEGIN PUBLIC KEY' "$PUBLIC_KEY_FILE"; then
  echo "$PUBLIC_KEY_FILE không phải public key PEM. Không đưa khoá riêng lên đây." >&2
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Khoá đã đưa lên rồi thì dùng lại, so sau khi bỏ khoảng trắng và xuống dòng.
PUBLIC_KEY_ID="$(aws cloudfront list-public-keys --output json | jq -r --rawfile key "$PUBLIC_KEY_FILE" '
  (.PublicKeyList.Items // [])
  | map(select((.EncodedKey | gsub("\\s"; "")) == ($key | gsub("\\s"; ""))))
  | first | .Id // empty')"
if [ -z "$PUBLIC_KEY_ID" ]; then
  KEY_NAME="$KEY_GROUP_NAME-$(date +%Y%m%d-%H%M%S)"
  PUBLIC_KEY_ID="$(aws cloudfront create-public-key --query 'PublicKey.Id' --output text --public-key-config \
    "$(jq -n --rawfile key "$PUBLIC_KEY_FILE" --arg name "$KEY_NAME" \
      '{CallerReference: $name, Name: $name, EncodedKey: $key, Comment: "TF82 cookie xem video"}')")"
  echo "Đã tạo public key $PUBLIC_KEY_ID"
else
  echo "Public key đã có: $PUBLIC_KEY_ID"
fi

KEY_GROUP_ID="$(aws cloudfront list-key-groups \
  --query "KeyGroupList.Items[?KeyGroup.KeyGroupConfig.Name=='$KEY_GROUP_NAME'].KeyGroup.Id | [0]" --output text)"
if [ "$KEY_GROUP_ID" = "None" ]; then
  KEY_GROUP_ID="$(aws cloudfront create-key-group --query 'KeyGroup.Id' --output text --key-group-config \
    "$(jq -n --arg name "$KEY_GROUP_NAME" --arg key "$PUBLIC_KEY_ID" '{Name: $name, Items: [$key], Comment: "TF82"}')")"
  echo "Đã tạo key group $KEY_GROUP_NAME ($KEY_GROUP_ID)"
else
  aws cloudfront get-key-group-config --id "$KEY_GROUP_ID" >"$TMP/key-group.json"
  if jq -e --arg key "$PUBLIC_KEY_ID" '.KeyGroupConfig.Items | index($key)' "$TMP/key-group.json" >/dev/null; then
    echo "Key group $KEY_GROUP_NAME ($KEY_GROUP_ID) đã có khoá này"
  else
    jq --arg key "$PUBLIC_KEY_ID" '.KeyGroupConfig | .Items += [$key]' "$TMP/key-group.json" >"$TMP/key-group-next.json"
    aws cloudfront update-key-group --id "$KEY_GROUP_ID" --if-match "$(jq -r .ETag "$TMP/key-group.json")" \
      --key-group-config "file://$TMP/key-group-next.json" >/dev/null
    echo "Đã thêm khoá vào key group $KEY_GROUP_NAME ($KEY_GROUP_ID)"
  fi
fi

echo
echo "Ghi vào deploy/.env.server trên server: CLOUDFRONT_KEY_PAIR_ID=$PUBLIC_KEY_ID"
