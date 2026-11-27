#!/bin/sh
# TF120: chạy trên server staging trong suốt buổi đo, lấy mẫu mỗi INTERVAL giây (mặc định 5).
#   nohup sh sample.sh > /dev/null 2>&1 & echo $! > sampler.pid      dừng: kill "$(cat sampler.pid)"
# Ghi vào ~/bench/feed-<giờ UTC>/: CPU, RAM từng container; kết nối và số dòng Postgres đọc; lag các nhóm consumer.
set -u
INTERVAL=${INTERVAL:-5}
D=$HOME/bench/feed-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$D" && echo "$D" > "$HOME/bench/CURRENT"
PG="docker exec -i tripflix-server-postgres-1 psql -U postgres -d core -AtF,"
RC="docker exec tripflix-server-redis-1 redis-cli --no-auth-warning"
echo "ts,container,cpu,mem" > "$D/docker.csv"
echo "ts,active,total,xact_commit,tup_returned,tup_fetched" > "$D/pg.csv"
echo "ts,load1" > "$D/host.csv"
echo "ts,stream,group,lag,pending" > "$D/redis.csv"
while :; do
  t=$(date -u +%FT%TZ)
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' | sed "s|^|$t,|" >> "$D/docker.csv"
  $PG -c "select count(*) filter (where a.state = 'active'), count(*), d.xact_commit, d.tup_returned, d.tup_fetched
          from pg_stat_activity a, pg_stat_database d
          where a.backend_type = 'client backend' and d.datname = 'core'
          group by d.xact_commit, d.tup_returned, d.tup_fetched" 2>/dev/null | sed "s|^|$t,|" >> "$D/pg.csv"
  awk -v t="$t" '{print t "," $1}' /proc/loadavg >> "$D/host.csv"
  for s in stream:app-events stream:core.content; do
    $RC XINFO GROUPS "$s" 2>/dev/null \
      | awk -v t="$t" -v s="$s" '/^name$/{getline n} /^pending$/{getline p} /^lag$/{getline l; print t "," s "," n "," l "," p}' >> "$D/redis.csv"
  done
  sleep "$INTERVAL"
done
