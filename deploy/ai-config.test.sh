#!/bin/sh
# Test ai-config.sh với docker giả, không đụng server hay Docker thật. Cần Linux (tail --pid, flock, setsid).
# Chạy trên máy dev: docker run --rm -v "$PWD/deploy:/w:ro" debian:12 sh /w/ai-config.test.sh
set -eu

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
# Chép ra chỗ ghi được và đặt quyền chạy như khi cài vào /opt/tripflix: script tự gọi lại "$0" (sudo, setsid).
SCRIPT="$ROOT/ai-config.sh"
cp "$(cd "$(dirname "$0")" && pwd)/ai-config.sh" "$SCRIPT"
chmod 755 "$SCRIPT"
export DEPLOY_DIR="$ROOT/deploy" BACKUP_DIR="$ROOT/backups" LOG_DIR="$ROOT/logs"
export AI_CONFIG_RUN_AS="$(id -un)" AI_CONFIG_SETTLE_SECONDS=0
CALLS="$ROOT/docker-calls"
mkdir -p "$DEPLOY_DIR" "$ROOT/bin"
touch "$DEPLOY_DIR/compose.server.yaml" "$DEPLOY_DIR/.env.server"

# docker giả: ghi lại lệnh; worker coi như khởi động lại liên tục khi .env.ai có LLM_PROVIDER=broken.
cat > "$ROOT/bin/docker" << EOF
#!/bin/sh
echo "\$*" >> "$CALLS"
case "\$*" in
  *" ps -q "*) echo "id-\${*##* }" ;;
  inspect*) if grep -q '^LLM_PROVIDER=broken' "$DEPLOY_DIR/.env.ai"; then echo "true 3"; else echo "true 0"; fi ;;
  *" logs "*) echo "dòng log" ;;
esac
EOF
chmod +x "$ROOT/bin/docker"
export PATH="$ROOT/bin:$PATH"

VALID='LOG_LEVEL=INFO
# comment
OPENAI_API_KEY=sk-old
LLM_PROVIDER=deepseek
CHAT_CONTROLLER_PRICE_INPUT=0.05
CHAT_CONTROLLER_PRICE_CACHED_INPUT=0.005
CHAT_CONTROLLER_PRICE_OUTPUT=0.4'

pass=0
fail=0
check() {
  if [ "$2" = "$3" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $1 (cần '$3', nhận '$2')"; fi
}
reset() {
  printf '%s\n' "$VALID" > "$DEPLOY_DIR/.env.ai"
  rm -rf "$BACKUP_DIR" "$LOG_DIR"
  : > "$CALLS"
}
run() {
  # run <stdin> <tham số...>: in mã thoát, giữ output trong $ROOT/out
  input="$1"
  shift
  code=0
  printf "%s" "$input" | "$SCRIPT" "$@" > "$ROOT/out" 2>&1 || code=$?
  echo "$code"
}
ups() { grep -c ' up ' "$CALLS" || true; }

reset
check "get in file" "$(run '' get)" 0
check "get đúng nội dung" "$(cat "$ROOT/out")" "$VALID"

reset
check "SSH_ORIGINAL_COMMAND get" "$(SSH_ORIGINAL_COMMAND=get run '')" 0

reset
NEW="$(printf '%s\n' "$VALID" | sed 's/sk-old/sk-new/')
CHAT_NEW_FLAG=true"
check "set hợp lệ" "$(run "$NEW
" set)" 0
check "set ghi file mới" "$(grep -c '^OPENAI_API_KEY=sk-new$' "$DEPLOY_DIR/.env.ai")" 1
check "set tạo lại service một lần" "$(ups)" 1
check "set có backup bản cũ" "$(grep -c 'sk-old' "$BACKUP_DIR"/env.ai-*)" 1
check "set in tên biến đổi, không in giá trị" "$(grep -c 'CHAT_NEW_FLAG OPENAI_API_KEY' "$ROOT/out")" 1
check "output không có key" "$(grep -c 'sk-new' "$ROOT/out" || true)" 0
check "audit ghi tên biến" "$(grep -c 'set ok: CHAT_NEW_FLAG OPENAI_API_KEY' "$LOG_DIR/ai-config.log")" 1
check "file mới quyền 600" "$(stat -c %a "$DEPLOY_DIR/.env.ai")" 600

reset
check "set không đổi" "$(run "$VALID
" set)" 0
check "set không đổi thì không tạo lại" "$(ups)" 0

for bad in \
  "CR|$(printf 'LOG_LEVEL=INFO\r')" \
  "sai dạng|lowercase=1" \
  "trùng tên|LOG_LEVEL=DEBUG" \
  "LD_PRELOAD|LD_PRELOAD=/tmp/x.so" \
  "PYTHONPATH|PYTHONPATH=/tmp" \
  "biến của compose|REDIS_URL=redis://evil:6379"; do
  reset
  name="${bad%%|*}"
  line="${bad#*|}"
  check "từ chối $name" "$(run "$VALID
$line
" set)" 1
  check "từ chối $name: file giữ nguyên" "$(cat "$DEPLOY_DIR/.env.ai")" "$VALID"
  check "từ chối $name: không tạo lại" "$(ups)" 0
done

for empty in 'CHAT_CONTROLLER_PRICE_OUTPUT=' 'CHAT_CONTROLLER_PRICE_OUTPUT=""' "CHAT_CONTROLLER_PRICE_OUTPUT=' '"; do
  reset
  check "từ chối giá rỗng ($empty)" "$(run "$(printf '%s\n' "$VALID" | grep -v '^CHAT_CONTROLLER_PRICE_OUTPUT=')
$empty
" set)" 1
  check "giá rỗng: file giữ nguyên" "$(cat "$DEPLOY_DIR/.env.ai")" "$VALID"
done

reset
check "từ chối thiếu LLM_PROVIDER" "$(run "$(printf '%s\n' "$VALID" | grep -v LLM_PROVIDER)
" set)" 1
check "thiếu LLM_PROVIDER: file giữ nguyên" "$(cat "$DEPLOY_DIR/.env.ai")" "$VALID"

reset
check "từ chối file quá lớn" "$(run "$(head -c 70000 /dev/zero | tr '\0' '#')
" set)" 1
check "file quá lớn: file giữ nguyên" "$(cat "$DEPLOY_DIR/.env.ai")" "$VALID"

reset
check "service lỗi thì trả bản cũ" "$(run "$(printf '%s\n' "$VALID" | sed 's/^LLM_PROVIDER=.*/LLM_PROVIDER=broken/')
" set)" 1
check "trả bản cũ: file như trước" "$(cat "$DEPLOY_DIR/.env.ai")" "$VALID"
check "trả bản cũ: tạo lại 2 lần" "$(ups)" 2
check "audit ghi lần lỗi" "$(grep -c 'set lỗi, đã trả bản cũ: LLM_PROVIDER' "$LOG_DIR/ai-config.log")" 1

reset
check "SSH không gọi thẳng apply" "$(SSH_ORIGINAL_COMMAND='apply .env.ai.new.x' run '')" 2
check "apply qua tham số cũng bị chặn" "$(run '' apply .env.ai.new.x)" 2
check "lệnh lạ" "$(SSH_ORIGINAL_COMMAND='sh -c id' run '')" 2
check "logs service lạ" "$(run '' logs core-api)" 2
check "logs số dòng không phải số" "$(run '' logs ai-service 1x)" 2
check "logs hợp lệ" "$(run '' logs ai-service 50)" 0
check "logs gọi đúng service" "$(grep -c 'logs --no-log-prefix --tail 50 ai-service' "$CALLS")" 1
check "logs số dòng lớn" "$(run '' logs ai-label-worker 99999)" 0
check "logs giới hạn 5000 dòng" "$(grep -c 'tail 5000 ai-label-worker' "$CALLS")" 1
check "status" "$(run '' status)" 0

rm "$DEPLOY_DIR/.env.ai"
check "chưa có .env.ai thì báo" "$(run '' get)" 1

echo "ai-config.sh: $pass đạt, $fail lỗi"
[ "$fail" -eq 0 ]
