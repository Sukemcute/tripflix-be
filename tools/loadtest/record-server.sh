#!/bin/sh
# Chạy trên server trong lúc test, Ctrl+C để dừng. Mỗi 5 giây ghi:
#   <tên>-docker.csv : CPU, RAM, mạng từng container
#   <tên>-db.csv     : số kết nối Postgres, số kết nối đang chạy query, tồn đọng stream notification
#   sh record-server.sh browse-100
set -eu
NAME=${1:?Cần tên lần chạy, ví dụ browse-100}
DC="docker compose -f $HOME/tripflix-be/deploy/compose.server.yaml --env-file $HOME/tripflix-be/deploy/.env.server --env-file $HOME/tripflix-be/deploy/.env.web"
DIR=$HOME/loadtest-results
mkdir -p "$DIR"
echo "time,container,cpu,mem,net" > "$DIR/$NAME-docker.csv"
echo "time,pg_connections,pg_active,stream_pending,stream_lag" > "$DIR/$NAME-db.csv"

while true; do
  NOW=$(date +%H:%M:%S)
  docker stats --no-stream --format "$NOW,{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}}" >> "$DIR/$NAME-docker.csv"
  PG=$($DC exec -T postgres psql -U postgres -d core -tAc \
    "select count(*), count(*) filter (where state = 'active') from pg_stat_activity where backend_type = 'client backend'" | tr '|' ',')
  # Tồn đọng của consumer group notification trên stream content (reaction, comment).
  GROUP=$($DC exec -T redis redis-cli XINFO GROUPS stream:core.content | awk '
    $0 == "pending" {getline; p = $0} $0 == "lag" {getline; l = $0} END {print p "," l}')
  echo "$NOW,$PG,$GROUP" >> "$DIR/$NAME-db.csv"
  sleep 5
done
