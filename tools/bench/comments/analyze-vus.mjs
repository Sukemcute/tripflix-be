// TF99: phân tích nút thắt cho chế độ vus. Mỗi lượt cắt đúng khung đo 60 s (mốc giờ k6 ghi trong setup) ra khỏi:
//   out/probe.jsonl (đầu đo trong core-api), res-host-*, res-docker-*, pg-* (run.sh lấy mẫu), rồi lấy trung vị qua các lần.
// Kết quả: out/vus-analysis.json (dữ liệu cho báo cáo) và out/vus-bottleneck.md (bảng đọc nhanh).
//   node tools/bench/comments/analyze-vus.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const VUS_FILE = /^v-(read|write|mixed)-(\d+)\.run(\d+)\.json$/;

const round = (value, digits = 1) => (value === undefined || Number.isNaN(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);
const max = (values) => (values.length ? Math.max(...values) : undefined);
function percentile(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
function median(values) {
  const clean = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  return clean.length ? percentile(clean, 0.5) : undefined;
}

function readLines(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
}

const probeLines = readLines(join(OUT, 'probe.jsonl')).map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}).filter(Boolean);

const inWindow = (t, w) => t >= w.start && t <= w.end;

function k6Metrics(data) {
  const values = (key) => data.metrics[key]?.values;
  const all = values('http_req_duration{step:measure}') ?? {};
  const byName = (name) => {
    const v = values(`http_req_duration{step:measure,name:${name}}`);
    return v?.count ? v : undefined;
  };
  const seconds = data.setup_data?.steps?.measure ?? 60;
  const thresholds = Object.values(data.metrics).flatMap((m) => Object.values(m.thresholds ?? {}));
  return {
    rps: (all.count ?? 0) / seconds,
    p50: all.med,
    p95: all['p(95)'],
    p99: all['p(99)'],
    avg: all.avg,
    readP95: byName('read')?.['p(95)'],
    writeP95: byName('write')?.['p(95)'],
    repliesP95: byName('replies')?.['p(95)'],
    writeAvg: byName('write')?.avg,
    readAvg: byName('read')?.avg,
    blockedAvg: values('http_req_blocked{step:measure}')?.avg,
    blockedP95: values('http_req_blocked{step:measure}')?.['p(95)'],
    connectingAvg: values('http_req_connecting{step:measure}')?.avg,
    waitingAvg: values('http_req_waiting{step:measure}')?.avg,
    waitingP95: values('http_req_waiting{step:measure}')?.['p(95)'],
    failRate: (values('http_req_failed{step:measure}')?.rate ?? 0) * 100,
    pagingBad: (values('paging_missing')?.count ?? 0) + (values('paging_duplicates')?.count ?? 0),
    passed: thresholds.every((r) => r.ok) ? 1 : 0,
  };
}

function probeMetrics(w) {
  const rows = probeLines.filter((row) => inWindow(row.t, w));
  if (!rows.length) return {};
  const server = rows.flatMap((row) => row.server);
  const poolRows = (name) => rows.map((row) => row.pools?.[name]).filter(Boolean);
  const content = poolRows('core-api:content');
  const access = poolRows('core-api:access');
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    elu: mean(rows.map((r) => r.elu)) * 100,
    eluP90: percentile(rows.map((r) => r.elu), 0.9) * 100,
    loopP99: median(rows.map((r) => r.loopP99)),
    loopMax: max(rows.map((r) => r.loopMax)),
    gcMsPerSec: sum('gcMs') / rows.length,
    heapMax: max(rows.map((r) => r.heapMB)),
    inFlightAvg: mean(rows.map((r) => r.inFlight)),
    inFlightMax: max(rows.map((r) => r.inFlight)),
    serverP50: percentile(server, 0.5),
    serverP95: percentile(server, 0.95),
    serverAvg: mean(server),
    serverRps: server.length / rows.length,
    connectWaitAvg: sum('connectCount') ? sum('connectWaitMs') / sum('connectCount') : 0,
    connectsPerSec: sum('connectCount') / rows.length,
    queryAvg: sum('queryCount') ? sum('queryMs') / sum('queryCount') : 0,
    queriesPerSec: sum('queryCount') / rows.length,
    queriesPerRequest: server.length ? sum('queryCount') / server.length : 0,
    dbMsPerRequest: server.length ? sum('queryMs') / server.length : 0,
    poolWaitMsPerRequest: server.length ? sum('connectWaitMs') / server.length : 0,
    contentInUseAvg: mean(content.map((p) => p.total - p.idle)),
    contentInUseMax: max(content.map((p) => p.total - p.idle)),
    contentWaitingAvg: mean(content.map((p) => p.waiting)),
    contentWaitingMax: max(content.map((p) => p.waiting)),
    contentPoolMax: content[0]?.max,
    accessInUseMax: max(access.map((p) => p.total - p.idle)),
    accessWaitingMax: max(access.map((p) => p.waiting)),
  };
}

/** Câu truy vấn trong khung đo, tính trên mỗi request HTTP: theo pool (module) và 12 mẫu câu tốn nhiều thời gian nhất. */
function probeDetail(w) {
  const rows = probeLines.filter((row) => inWindow(row.t, w));
  const requests = rows.reduce((total, row) => total + row.server.length, 0);
  if (!rows.length || !requests) return null;
  const merge = (key) => {
    const merged = {};
    for (const row of rows) {
      for (const [name, value] of Object.entries(row[key] ?? {})) {
        const target = (merged[name] ??= { count: 0, ms: 0 });
        target.count += value.count;
        target.ms += value.ms;
      }
    }
    return Object.entries(merged)
      .map(([name, value]) => ({
        name,
        perRequest: round(value.count / requests, 2),
        msPerRequest: round(value.ms / requests, 2),
        avgMs: round(value.ms / value.count, 2),
        perSecond: round(value.count / rows.length, 1),
      }))
      .sort((a, b) => b.msPerRequest - a.msPerRequest);
  };
  return { byPool: merge('queriesByPool'), signatures: merge('queriesBySignature').slice(0, 12) };
}

function hostMetrics(run, w) {
  const rows = readLines(join(OUT, `res-host-${run}.csv`)).map((line) => line.split(',').map(Number)).filter((c) => inWindow(c[0], w));
  if (!rows.length) return {};
  return {
    hostCpu: mean(rows.map((c) => c[1])),
    hostCpuP90: percentile(rows.map((c) => c[1]), 0.9),
    coreCpu: mean(rows.map((c) => c[2])),
    coreCpuP90: percentile(rows.map((c) => c[2]), 0.9),
    coreRssMax: max(rows.map((c) => c[3])),
  };
}

function dockerMetrics(run, w) {
  const rows = readLines(join(OUT, `res-docker-${run}.csv`))
    .map((line) => line.split(','))
    .filter((c) => c.length >= 3 && inWindow(Number(c[0]), w));
  const of = (pattern) => rows.filter((c) => pattern.test(c[1])).map((c) => Number(c[2].replace('%', '')));
  return {
    pgCpu: mean(of(/postgres/)),
    pgCpuMax: max(of(/postgres/)),
    redisCpu: mean(of(/redis/)),
    k6Cpu: mean(of(/tf99-k6/)),
    k6CpuMax: max(of(/tf99-k6/)),
  };
}

function pgMetrics(run, w) {
  const rows = readLines(join(OUT, `pg-${run}.csv`)).map((line) => line.split(',').map(Number)).filter((c) => c.length === 8 && inWindow(c[0], w));
  if (!rows.length) return {};
  const col = (i) => rows.map((c) => c[i]);
  return {
    pgSessionsMax: max(col(1)),
    pgActiveAvg: mean(col(2)),
    pgActiveMax: max(col(2)),
    pgLockAvg: mean(col(3)),
    pgLockMax: max(col(3)),
    pgLockShare: (rows.filter((c) => c[3] > 0).length / rows.length) * 100,
    pgLwlockAvg: mean(col(4)),
    pgIoAvg: mean(col(5)),
    pgClientReadAvg: mean(col(6)),
    pgIdleInTxAvg: mean(col(7)),
  };
}

function countCheck(run) {
  const row = readLines(join(OUT, `count-${run}.csv`))[0]?.split(',').map(Number);
  if (!row) return {};
  return { countOk: row[0] === row[1] && row[2] === 0 ? 1 : 0 };
}

const groups = new Map();
for (const file of readdirSync(OUT)) {
  const match = VUS_FILE.exec(file);
  if (!match) continue;
  const [, kind, vus, index] = match;
  const run = `v-${kind}-${vus}.run${index}`;
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  const window = { start: data.setup_data?.measureStartAt, end: data.setup_data?.measureEndAt };
  const metrics = {
    ...k6Metrics(data),
    ...(window.start ? { ...probeMetrics(window), ...hostMetrics(run, window), ...dockerMetrics(run, window), ...pgMetrics(run, window) } : {}),
    ...countCheck(run),
  };
  const key = `${kind}:${vus}`;
  if (!groups.has(key)) groups.set(key, { kind, vus: Number(vus), runs: [] });
  groups.get(key).runs.push({ index: Number(index), metrics, detail: window.start ? probeDetail(window) : null });
}

const KIND_ORDER = { read: 0, mixed: 1, write: 2 };
const levels = [...groups.values()]
  .filter((group) => group.runs.some((r) => r.metrics.elu !== undefined))
  .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.vus - b.vus)
  .map(({ kind, vus, runs }) => {
    const keys = new Set(runs.flatMap((r) => Object.keys(r.metrics)));
    const medianMetrics = {};
    for (const key of keys) medianMetrics[key] = round(median(runs.map((r) => r.metrics[key])), 2);
    const p95s = runs.map((r) => r.metrics.p95).filter((v) => v !== undefined);
    return {
      kind,
      vus,
      runCount: runs.length,
      passedRuns: runs.filter((r) => r.metrics.passed).length,
      p95Low: round(Math.min(...p95s)),
      p95High: round(Math.max(...p95s)),
      ...medianMetrics,
      detail: runs.sort((a, b) => a.index - b.index).find((r) => r.detail)?.detail ?? null,
    };
  });

const profiles = {};
for (const file of readdirSync(OUT)) {
  const match = /^profile-(v-\w+-\d+)\.json$/.exec(file);
  if (match) profiles[match[1]] = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
}

writeFileSync(join(OUT, 'vus-analysis.json'), JSON.stringify({ generatedAt: new Date().toISOString(), levels, profiles }, null, 2));

const fmt = (v, d = 0) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
const lines = ['# Nút thắt theo số VU (trung vị các lần, khung đo 60 s)', ''];
for (const kind of ['read', 'mixed', 'write']) {
  const rows = levels.filter((l) => l.kind === kind);
  if (!rows.length) continue;
  lines.push(`## ${kind}`, '');
  lines.push(
    '| VU | Lần | Đạt | req/s | p95 k6 | p95 server | Chờ kết nối k6 | ELU core | Loop p99 | GC ms/s | CPU core | CPU máy | CPU PG | CPU k6 | Pool content dùng/chờ (max) | Chờ mượn kết nối | DB ms/req | Câu/req | PG chạy (TB) | PG chờ khoá |',
    '|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|',
  );
  for (const l of rows) {
    lines.push(
      `| ${l.vus} | ${l.runCount} | ${l.passedRuns}/${l.runCount} | ${fmt(l.rps)} | ${fmt(l.p95, 1)} | ${fmt(l.serverP95, 1)} | ${fmt(l.blockedAvg, 2)} | ${fmt(l.elu)}% | ${fmt(l.loopP99, 1)} | ${fmt(l.gcMsPerSec)} | ${fmt(l.coreCpu)}% | ${fmt(l.hostCpu)}% | ${fmt(l.pgCpu)}% | ${fmt(l.k6Cpu)}% | ${fmt(l.contentInUseMax)}/${fmt(l.contentWaitingMax)} | ${fmt(l.connectWaitAvg, 2)} ms | ${fmt(l.dbMsPerRequest, 1)} | ${fmt(l.queriesPerRequest, 1)} | ${fmt(l.pgActiveAvg, 1)} | ${fmt(l.pgLockShare)}% |`,
    );
  }
  lines.push('');
}
writeFileSync(join(OUT, 'vus-bottleneck.md'), `${lines.join('\n')}\n`);
process.stdout.write(lines.join('\n'));
