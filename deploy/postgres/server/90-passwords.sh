#!/bin/sh
# Chỉ dùng trên server: thay mật khẩu dev của 02-roles-schemas.sql bằng giá trị trong .env.server.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=access="$DB_PASS_ACCESS" \
  --set=content="$DB_PASS_CONTENT" \
  --set=discovery="$DB_PASS_DISCOVERY" \
  --set=analytics="$DB_PASS_ANALYTICS" \
  --set=commerce="$DB_PASS_COMMERCE" \
  --set=notification="$DB_PASS_NOTIFICATION" <<'SQL'
ALTER ROLE tf_access PASSWORD :'access';
ALTER ROLE tf_content PASSWORD :'content';
ALTER ROLE tf_discovery PASSWORD :'discovery';
ALTER ROLE tf_analytics PASSWORD :'analytics';
ALTER ROLE tf_commerce PASSWORD :'commerce';
ALTER ROLE tf_notification PASSWORD :'notification';
SQL
