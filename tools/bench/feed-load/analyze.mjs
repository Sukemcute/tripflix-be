// TF120: ghép summary k6 (out/) với số mẫu của server (thư mục feed-<giờ> chép về) thành bảng Markdown và dữ liệu biểu đồ.
//   node tools/bench/feed-load/analyze.mjs <thư mục out> <thư mục mẫu server>
// In bảng ra stdout, ghi <thư mục out>/series.json (CPU, băng thông, lag theo thời gian) để vẽ biểu đồ trong evidence.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, sampleDir] = process.argv.slice(2);
if (!outDir || !sampleDir) {
  console.error('Dùng: node analyze.mjs <thư mục out> <thư mục mẫu server>');
  process.exit(2);
}

function readCsv(path) {
  if (!existsSync(path)) return [];
  const [head, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const keys = head.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}

const runs = readCsv(join(outDir, 'runs.csv'));
const docker = readCsv(join(sampleDir, 'docker.csv')).map((r) => ({
  ts: Date.parse(r.ts),
  container: r.container.replace(/^tripflix-server-/, '').replace(/-1$/, ''),
  cpu: Number.parseFloat(r.cpu),
}));
const redis = readCsv(join(sampleDir, 'redis.csv')).map((r) => ({
  ...r,
  ts: Date.parse(r.ts),
  lag: Number(r.lag),
}));

const metric = (summary, name, key) => summary.metrics[name]?.[key] ?? null;
/** Trend không có mẫu nào (ví dụ chưa lượt nào trúng cache) thì coi là chưa có số, không phải 0 ms. */
const trend = (summary, name, key) => (metric(summary, name, 'count') ? metric(summary, name, key) : null);
// Thời lượng mỗi mức của scale.js (DURATION trong run.sh), để tính req/s không lẫn request của setup.
const SCALE_SEC = Number(process.env.SCALE_SEC || 60);
const ms = (v) => (v === null ? '–' : Math.round(v).toString());
const pct = (v) => (v === null ? '–' : `${(v * 100).toFixed(2)}%`);

/** CPU trung bình (đơn vị % của 1 core) của các container khớp `match` trong khoảng [start, end]. */
function avgCpu(start, end, match) {
  const rows = docker.filter((r) => r.ts >= start && r.ts <= end && match(r.container));
  const perTs = new Map();
  for (const r of rows) perTs.set(r.ts, (perTs.get(r.ts) ?? 0) + r.cpu);
  const values = [...perTs.values()];
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}
const isCoreApi = (c) => c.startsWith('core-api');
const isPostgres = (c) => c === 'postgres';

function load(run) {
  const file = join(outDir, `${run.scenario}-${run.label}-${run.level}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

const tables = { scale: [], cdn: [], events: [] };
for (const run of runs) {
  const summary = load(run);
  if (!summary) continue;
  // Bỏ 20 giây đầu (khởi động, tăng người) khi tính CPU.
  const start = Date.parse(run.start) + 20_000;
  const end = Date.parse(run.end);
  const cpuApi = avgCpu(start, end, isCoreApi);
  const cpuPg = avgCpu(start, end, isPostgres);
  const failed = metric(summary, 'http_req_failed', 'value');
  if (run.scenario === 'scale') {
    tables.scale.push(
      `| ${run.label} | ${run.level} | ${((metric(summary, 'http_reqs{name:feed}', 'count') ?? 0) / SCALE_SEC).toFixed(0)} | ${ms(trend(summary, 'http_req_duration{name:feed}', 'med'))} | ${ms(trend(summary, 'http_req_duration{name:feed}', 'p(95)'))} | ${pct(failed)} | ${cpuApi ?? '–'} | ${cpuPg ?? '–'} |`,
    );
  } else if (run.scenario === 'cdn') {
    const mbps = (metric(summary, 'video_bytes', 'rate') ?? 0) / 1e6;
    tables.cdn.push(
      `| ${run.level} | ${mbps.toFixed(2)} | ${pct(metric(summary, 'cdn_hit', 'value'))} | ${ms(trend(summary, 'segment_ms{cache:hit}', 'p(95)'))} | ${ms(trend(summary, 'segment_ms{cache:miss}', 'p(95)'))} | ${ms(trend(summary, 'http_req_duration{name:feed}', 'p(95)'))} | ${pct(failed)} | ${cpuApi ?? '–'} |`,
    );
  } else if (run.scenario === 'events') {
    const appLag = redis.filter((r) => r.stream === 'stream:app-events');
    const during = appLag.filter((r) => r.ts >= Date.parse(run.start));
    const maxLag = during.reduce((m, r) => Math.max(m, r.lag), 0);
    // Thời gian từ lúc k6 dừng tới mẫu đầu tiên mọi nhóm đọc xong (tổng lag = 0).
    const byTs = new Map();
    for (const r of during) byTs.set(r.ts, (byTs.get(r.ts) ?? 0) + r.lag);
    const drained = [...byTs.entries()]
      .sort((a, b) => a[0] - b[0])
      .find(([ts, lag]) => ts >= end && lag === 0);
    const drainSec = drained ? Math.round((drained[0] - end) / 1000) : null;
    tables.events.push(
      `| ${run.level} | ${metric(summary, 'http_reqs', 'rate')?.toFixed(0)} | ${ms(trend(summary, 'http_req_duration{name:feed_events}', 'med'))} | ${ms(trend(summary, 'http_req_duration{name:feed_events}', 'p(95)'))} | ${pct(failed)} | ${maxLag} | ${drainSec ?? 'chưa về 0'} | ${cpuApi ?? '–'} |`,
    );
  }
}

const out = [];
if (tables.scale.length)
  out.push(
    '### Phép 2: lướt feed theo tốc độ',
    '| Cấu hình | Mục tiêu req/s | Đạt req/s | p50 ms | p95 ms | Lỗi | CPU core-api % | CPU Postgres % |',
    '|---|---|---|---|---|---|---|---|',
    ...tables.scale,
    '',
  );
if (tables.cdn.length)
  out.push(
    '### Phép 1: xem video qua CDN',
    '| Người xem | Video MB/s | Trúng cache | p95 đoạn HIT ms | p95 đoạn MISS ms | p95 feed ms | Lỗi | CPU core-api % |',
    '|---|---|---|---|---|---|---|---|',
    ...tables.cdn,
    '',
  );
if (tables.events.length)
  out.push(
    '### Phép 4: bắn dồn lượt xem',
    '| VU | req/s | p50 ms | p95 ms | Lỗi | Lag lớn nhất | Về 0 sau (giây) | CPU core-api % |',
    '|---|---|---|---|---|---|---|---|',
    ...tables.events,
    '',
  );
console.log(out.join('\n'));

// Chuỗi thời gian cho biểu đồ: CPU core-api, Postgres theo từng mẫu; lag stream:app-events theo nhóm.
const series = {
  runs,
  cpu: [...new Set(docker.map((r) => r.ts))].sort().map((ts) => ({
    ts,
    coreApi: docker.filter((r) => r.ts === ts && isCoreApi(r.container)).reduce((a, r) => a + r.cpu, 0),
    postgres: docker.find((r) => r.ts === ts && isPostgres(r.container))?.cpu ?? null,
  })),
  lag: redis
    .filter((r) => r.stream === 'stream:app-events')
    .map(({ ts, group, lag }) => ({ ts, group, lag })),
};
writeFileSync(join(outDir, 'series.json'), JSON.stringify(series));
