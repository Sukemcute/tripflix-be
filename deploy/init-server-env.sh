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
# X25519 thô 32 byte, base64url, như lệnh auth:password-keygen: client mã hoá mật khẩu trước khi gửi (TF056).
password_key=$(openssl genpkey -algorithm X25519 -outform DER 2>/dev/null | tail -c 32 | base64 | tr '+/' '-_' | tr -d '=\n')
cat > "$target" <<ENV
POSTGRES_PASSWORD=$(secret)
DB_PASS_ACCESS=$(secret)
DB_PASS_CONTENT=$(secret)
DB_PASS_DISCOVERY=$(secret)
DB_PASS_ANALYTICS=$(secret)
DB_PASS_COMMERCE=$(secret)
DB_PASS_NOTIFICATION=$(secret)
AUTH_JWT_PRIVATE_KEY="$jwt_key"
AUTH_PASSWORD_KEYS="k1:$password_key"
# Mật khẩu chung của 3 tài khoản mẫu, gồm cả superadmin.
SEED_PASSWORD=$(secret)

# Điền tay. Key chỉ ghi được S3_KEY_PREFIX dưới đây.
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-2
S3_MEDIA_BUCKET=tripflix-media-dev
S3_KEY_PREFIX=staging/
MEDIA_CDN_URL=https://d399hxccn6y84z.cloudfront.net

# Địa chỉ công khai. DNS của cả hai, và của www.<WEB_HOST>, phải trỏ về máy này trước khi bật gateway.
API_HOST=
WEB_HOST=
AUTH_WEB_ORIGINS=
AUTH_PASSWORD_RESET_URL=
AUTH_EMAIL_VERIFY_URL=

# Đăng nhập Google (deploy/SERVER.md, mục Đăng nhập Google). Trống thì tắt.
GOOGLE_CLIENT_IDS=

# Gửi email qua Amazon SES (profile mail, deploy/SERVER.md Giai đoạn 4). Điền sau khi xác thực tên miền trên SES.
SMTP_URL=
MAIL_FROM=Tripflix <no-reply@tripflix.io.vn>
WEB_APP_URL=

# Tag image trên GHCR, mỗi app một biến vì CI chỉ build app có thay đổi. Nên đổi sang sha-<7 ký tự> để biết chính xác bản đang chạy.
CORE_API_TAG=develop
NOTIFICATION_TAG=develop

# AI (profile ai, deploy/SERVER.md Giai đoạn 5): tóm tắt dùng DeepSeek, kiểm duyệt dùng OpenAI. Secret tạo bằng auth:create-service-client.
AI_TAG=develop

# Chuyển mã video (profile video, deploy/SERVER.md Giai đoạn 6), bản Go. Cần key AWS ở trên.
VIDEO_WORKER_TAG=develop
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
AI_SERVICE_CLIENT_SECRET=
# Kiểm duyệt: core-api gọi ai-service. Đặt AI_SERVICE_URL=http://ai-service:8000 khi ai-service đã chạy.
AI_SERVICE_URL=
MODERATION_SERVICE_CLIENT_SECRET=
ENV
echo "Đã tạo $target (quyền 600). Còn phải điền AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY."
