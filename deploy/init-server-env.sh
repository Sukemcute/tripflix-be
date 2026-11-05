#!/bin/sh
# Sinh file secret cho server: sh deploy/init-server-env.sh [đường dẫn, mặc định deploy/.env.server]
# Không ghi đè file đã có, vì đổi mật khẩu ở đây không đổi được mật khẩu trong database đã khởi tạo.
set -eu
target="${1:-$(dirname "$0")/.env.server}"
if [ -e "$target" ]; then
  echo "Đã có $target, không ghi đè" >&2
  exit 1
fi
umask 077
secret() { openssl rand -hex 24; }
# PEM PKCS8 của ES256, đổi xuống dòng thành \n như lệnh auth:keygen.
jwt_key=$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null | awk 'NF{printf "%s\\n", $0}')
cat > "$target" <<ENV
POSTGRES_PASSWORD=$(secret)
DB_PASS_ACCESS=$(secret)
DB_PASS_CONTENT=$(secret)
DB_PASS_DISCOVERY=$(secret)
DB_PASS_ANALYTICS=$(secret)
DB_PASS_COMMERCE=$(secret)
DB_PASS_NOTIFICATION=$(secret)
AUTH_JWT_PRIVATE_KEY="$jwt_key"
# Mật khẩu chung của 3 tài khoản mẫu, gồm cả superadmin.
SEED_PASSWORD=$(secret)

# Điền tay. Key chỉ ghi được S3_KEY_PREFIX dưới đây.
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-2
S3_MEDIA_BUCKET=tripflix-media-dev
S3_KEY_PREFIX=dev/phong/
MEDIA_CDN_URL=https://d399hxccn6y84z.cloudfront.net

# Tag image trên GHCR; nên đổi sang sha-<7 ký tự> để biết chính xác bản đang chạy.
IMAGE_TAG=develop
ENV
echo "Đã tạo $target (quyền 600). Còn phải điền AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY."
