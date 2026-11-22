#!/usr/bin/env bash
# Chọn image cần build cho lần publish này, ghi apps=[...] vào GITHUB_OUTPUT.
#   $1: các app, cách nhau bởi dấu cách; app <tên> nằm trong apps/<tên>/
#   $2: regex đường dẫn dùng chung (đổi là build lại mọi app)
# So với commit của lần publish thành công gần nhất trên cùng nhánh, không phải commit liền trước:
# lần chạy bị huỷ (merge mới đè lên) hay bị lỗi thì phần thay đổi của nó vẫn được build ở lần sau.
set -euo pipefail

apps="$1"
shared="$2"

# ["a","b"] từ danh sách tên cách nhau bởi dấu cách; tên app chỉ gồm chữ, số, gạch nối nên không cần escape.
to_json() {
  local out="" name
  for name in $1; do out="$out${out:+,}\"$name\""; done
  echo "[$out]"
}

emit() {
  echo "apps=$1" >> "$GITHUB_OUTPUT"
  echo "Image cần build: $1 ($2)"
}

all=$(to_json "$apps")

# Tag phát hành luôn build đủ.
if [[ "$GITHUB_REF" == refs/tags/* ]]; then emit "$all" "tag"; exit 0; fi

base=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow publish.yml --branch "$GITHUB_REF_NAME" --status success --limit 1 --json headSha --jq '.[0].headSha // ""')
if [[ -z "$base" ]] || ! git merge-base --is-ancestor "$base" "$GITHUB_SHA" 2>/dev/null; then
  emit "$all" "chưa có lần publish thành công để so"
  exit 0
fi

changed=$(git diff --name-only "$base" "$GITHUB_SHA")
if grep -Eq "$shared" <<< "$changed"; then
  emit "$all" "đổi phần dùng chung so với ${base:0:7}"
  exit 0
fi

picked=""
for app in $apps; do
  if grep -q "^apps/$app/" <<< "$changed"; then picked="$picked $app"; fi
done
emit "$(to_json "$picked")" "so với ${base:0:7}"
