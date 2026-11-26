// TF99: tổng hợp stress và spike theo số người (run.sh vstress, vspike): ghép từng giây của đầu đo trong core-api
// (probe.jsonl), mẫu CPU, Postgres, độ trễ stream sự kiện với lịch VU của k6, rồi tìm điểm gãy và thời gian hồi phục.
//   node tools/bench/comments/analyze-stress.mjs   → out/stress-analysis.json, out/stress-report.md
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const READ_THRESHOLD_MS = 150;
const ERROR_THRESHOLD = 0.01;
const ROLLING_SECONDS = 5;
// Hồi phục: 10 giây liền p95 dưới ngưỡng, không còn request chờ mượn kết nối và không có 5xx.
const RECOVERY_STABLE_SECONDS = 10;
const STREAM_GROUPS = ['core-analytics', 'core-discovery', 'core-moderation'];

const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const median = (values) => quantile(values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)), 0.5);
const avg = (values) => {
  const usable = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
};
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// Đọc probe.jsonl một lần, giữ các dòng trong khoảng thời gian của mọi lượt stress.
function loadProbe(windows) {
  const file = join(OUT, 'probe.jsonl');
  const lines = [];
  for (const raw of readLines(file)) {
    const at = Number(/"t":(\d+)/.exec(raw)?.[1]);
    if (!windows.some(([from, to]) => at >= from && at <= to)) continue;
    const line = JSON.parse(raw);
    if (line.pools && Object.keys(line.pools).length) lines.push(line);
  }
  return lines;
}

function vusAt(setup, at) {
  let from = setup.startVus;
  for (const phase of setup.phases) {
    if (at < phase.endAt) {
      const share = (at - phase.startAt) / (phase.endAt - phase.startAt);
      return Math.round(from + (phase.target - from) * Math.max(0, share));
    }
    from = phase.target;
  }
  return from;
}

function bySecond(rows, startAt, pick) {
  const buckets = new Map();
  for (const row of rows) {
    const second = Math.floor((row.at - startAt) / 1000);
    if (!buckets.has(second)) buckets.set(second, []);
    buckets.get(second).push(pick(row));
  }
  return buckets;
}

function loadRun(file) {
  const summary = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  const setup = summary.setup_data;
  const run = file.replace(/\.json$/, '');
  return { run, summary, setup };
}

function streamRows(run) {
  return readLines(join(OUT, `stream-${run}.csv`)).map((line) => {
    const [at, ...fields] = line.split(',');
    const groups = {};
    let current = null;
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] === 'name') current = groups[fields[i + 1]] = {};
      else if (current) current[fields[i]] = Number(fields[i + 1]);
    }
    return { at: Number(at), groups };
  });
}

function buildTimeline({ run, setup }, probe) {
  const from = setup.startAt - 30_000;
  const to = setup.endAt + 40_000;
  const host = readLines(join(OUT, `res-host-${run}.csv`)).map((l) => l.split(',').map(Number)).map(([at, hostCpu, coreCpu, rss]) => ({ at, hostCpu, coreCpu, rss }));
  const docker = readLines(join(OUT, `res-docker-${run}.csv`)).map((l) => l.split(',')).map(([at, name, cpu]) => ({ at: Number(at), name, cpu: parseFloat(cpu) }));
  const pg = readLines(join(OUT, `pg-${run}.csv`)).map((l) => l.split(',').map(Number)).map(([at, sessions, active, lock]) => ({ at, sessions, active, lock }));
  const streams = streamRows(run);
  const hostBy = bySecond(host, setup.startAt, (r) => r);
  const pgBy = bySecond(pg, setup.startAt, (r) => r);
  const dockerBy = bySecond(docker, setup.startAt, (r) => r);
  const streamBy = bySecond(streams, setup.startAt, (r) => r.groups);

  const timeline = [];
  for (const line of probe) {
    if (line.t < from || line.t > to) continue;
    // Dòng probe ghi lúc cuối giây đo: số liệu thuộc giây trước đó.
    const at = line.t - 500;
    const second = Math.floor((at - setup.startAt) / 1000);
    const status = line.status ?? {};
    const served = line.server.length;
    const content = line.pools['core-api:content'] ?? {};
    const hostRows = hostBy.get(second) ?? [];
    const pgRows = pgBy.get(second) ?? [];
    const dockerRows = dockerBy.get(second) ?? [];
    const streamGroups = (streamBy.get(second) ?? [])[0];
    const dockerCpu = (needle) => avg(dockerRows.filter((r) => r.name.includes(needle)).map((r) => r.cpu));
    timeline.push({
      s: second,
      vus: at < setup.startAt ? setup.startVus : vusAt(setup, at),
      rps: served,
      p50: quantile(line.server, 0.5),
      p95: quantile(line.server, 0.95),
      p99: quantile(line.server, 0.99),
      err5xx: status['5xx'] ?? 0,
      elu: Math.round(line.elu * 100),
      inFlight: line.inFlight,
      contentWaiting: content.waiting ?? 0,
      contentInUse: (content.total ?? 0) - (content.idle ?? 0),
      connectWaitAvg: line.connectCount ? round(line.connectWaitMs / line.connectCount) : 0,
      heapMB: line.heapMB,
      rssMB: line.rssMB,
      gcMs: line.gcMs,
      hostCpu: avg(hostRows.map((r) => r.hostCpu)),
      coreCpu: avg(hostRows.map((r) => r.coreCpu)),
      pgCpu: dockerCpu('postgres'),
      k6Cpu: dockerCpu('tf99-k6'),
      pgActive: avg(pgRows.map((r) => r.active)),
      pgLock: avg(pgRows.map((r) => r.lock)),
      lag: streamGroups ? Object.fromEntries(STREAM_GROUPS.map((g) => [g, streamGroups[g]?.lag ?? null])) : null,
      pending: streamGroups ? Object.fromEntries(STREAM_GROUPS.map((g) => [g, streamGroups[g]?.pending ?? null])) : null,
    });
  }
  timeline.sort((a, b) => a.s - b.s);
  return timeline;
}

// Giá trị cuộn ROLLING_SECONDS giây: p95 của mọi request trong cửa sổ thì cần dữ liệu gốc, nên dùng trung bình p95 từng giây.
function rolling(timeline, index, pick, seconds = ROLLING_SECONDS) {
  return avg(timeline.slice(Math.max(0, index - seconds + 1), index + 1).map(pick));
}
function rollingErrorRate(timeline, index, seconds = ROLLING_SECONDS) {
  const window = timeline.slice(Math.max(0, index - seconds + 1), index + 1);
  const served = window.reduce((a, r) => a + r.rps, 0);
  return served ? window.reduce((a, r) => a + r.err5xx, 0) / served : 0;
}

function analyseRun(runData, probe) {
  const { setup, summary } = runData;
  const timeline = buildTimeline(runData, probe);
  const peakPhase = setup.phases.find((p) => p.name === 'hold' || p.name === 'peak');
  const down = setup.phases.find((p) => p.name === 'down');
  const secondOf = (at) => Math.floor((at - setup.startAt) / 1000);
  const loadPart = timeline.filter((r) => r.s >= 0 && r.s < secondOf(down.startAt));

  const firstCross = (test) => {
    for (let i = 0; i < timeline.length; i++) {
      const row = timeline[i];
      if (row.s < 0 || row.s >= secondOf(down.startAt)) continue;
      if (test(i)) return { s: row.s, vus: row.vus };
    }
    return null;
  };
  const breakpoints = {
    loopBusy80: firstCross((i) => rolling(timeline, i, (r) => r.elu) >= 80),
    loopFull: firstCross((i) => rolling(timeline, i, (r) => r.elu) >= 95),
    poolQueue: firstCross((i) => rolling(timeline, i, (r) => r.contentWaiting) >= 5),
    p95Over: firstCross((i) => rolling(timeline, i, (r) => r.p95 ?? 0) > READ_THRESHOLD_MS),
    p95Over1s: firstCross((i) => rolling(timeline, i, (r) => r.p95 ?? 0) > 1000),
    errorsOver: firstCross((i) => rollingErrorRate(timeline, i) > ERROR_THRESHOLD),
  };

  // Thông lượng cao nhất giữ được 10 s liền, và lúc đó có bao nhiêu VU.
  let bestRps = { rps: 0, s: null, vus: null };
  for (let i = 0; i < timeline.length; i++) {
    const value = rolling(timeline, i, (r) => r.rps, 10);
    if (value > bestRps.rps && timeline[i].s >= 0) bestRps = { rps: round(value), s: timeline[i].s, vus: timeline[i].vus };
  }

  const inPhase = (phase) => timeline.filter((r) => r.s >= secondOf(phase.startAt) && r.s < secondOf(phase.endAt));
  const peakRows = inPhase(peakPhase);
  const peakServed = peakRows.reduce((a, r) => a + r.rps, 0);
  const peak = {
    vus: peakPhase.target,
    rps: round(avg(peakRows.map((r) => r.rps))),
    p95: round(median(peakRows.map((r) => r.p95))),
    errorRate: peakServed ? round((peakRows.reduce((a, r) => a + r.err5xx, 0) / peakServed) * 100, 2) : null,
    elu: round(avg(peakRows.map((r) => r.elu))),
    contentWaitingMax: Math.max(0, ...peakRows.map((r) => r.contentWaiting)),
    inFlightMax: Math.max(0, ...peakRows.map((r) => r.inFlight)),
    pgCpu: round(avg(peakRows.map((r) => r.pgCpu))),
    pgActive: round(avg(peakRows.map((r) => r.pgActive))),
    coreCpu: round(avg(peakRows.map((r) => r.coreCpu))),
    k6Cpu: round(avg(peakRows.map((r) => r.k6Cpu))),
    hostCpu: round(avg(peakRows.map((r) => r.hostCpu))),
  };

  // Hồi phục, tính từ lúc tải đã hạ xong (hết đoạn down).
  const downEnd = secondOf(down.endAt);
  let recoverySeconds = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].s < downEnd) continue;
    const window = timeline.slice(i, i + RECOVERY_STABLE_SECONDS);
    if (window.length < RECOVERY_STABLE_SECONDS) break;
    if (window.every((r) => (r.p95 ?? 0) < READ_THRESHOLD_MS && r.contentWaiting === 0 && r.err5xx === 0)) {
      recoverySeconds = timeline[i].s - downEnd;
      break;
    }
  }
  const before = timeline.filter((r) => r.s < 0);
  const tail = timeline.filter((r) => r.s >= secondOf(setup.endAt) - 30 && r.s < secondOf(setup.endAt));
  const afterRecovery = timeline.filter((r) => r.s >= downEnd + (recoverySeconds ?? 0) + RECOVERY_STABLE_SECONDS && r.s < secondOf(setup.endAt));

  // Stream: lag cao nhất của từng nhóm consumer, và bao lâu sau khi hạ tải thì về lại mức trước khi đo.
  const streams = {};
  for (const group of STREAM_GROUPS) {
    const lagOf = (r) => r.lag?.[group];
    const baseline = median(before.map(lagOf)) ?? 0;
    const withLag = timeline.filter((r) => Number.isFinite(lagOf(r)));
    const maxRow = withLag.reduce((best, r) => (lagOf(r) > (lagOf(best) ?? -1) ? r : best), withLag[0] ?? null);
    let drainedAt = null;
    for (const r of withLag) {
      if (r.s >= downEnd && lagOf(r) <= baseline + 10) { drainedAt = r.s; break; }
    }
    streams[group] = {
      baseline,
      max: maxRow ? lagOf(maxRow) : null,
      maxAtVus: maxRow?.vus ?? null,
      drainSeconds: drainedAt === null ? null : drainedAt - downEnd,
      endLag: withLag.length ? lagOf(withLag[withLag.length - 1]) : null,
    };
  }

  const memory = {
    heapBefore: median(before.map((r) => r.heapMB)) ?? median(loadPart.slice(0, 30).map((r) => r.heapMB)),
    heapPeak: Math.max(0, ...timeline.map((r) => r.heapMB)),
    heapAfter: median(tail.map((r) => r.heapMB)),
    rssBefore: median(before.map((r) => r.rssMB)) ?? median(loadPart.slice(0, 30).map((r) => r.rssMB)),
    rssPeak: Math.max(0, ...timeline.map((r) => r.rssMB)),
    rssAfter: median(tail.map((r) => r.rssMB)),
  };

  const afterRows = afterRecovery.length ? afterRecovery : tail;
  const after = { p95: round(median(afterRows.map((r) => r.p95))), elu: round(avg(afterRows.map((r) => r.elu))), rps: round(avg(afterRows.map((r) => r.rps))) };
  const baselineRows = timeline.filter((r) => r.s >= 0 && r.vus <= 60 && r.s < secondOf(down.startAt));
  const base = { p95: round(median(baselineRows.map((r) => r.p95))), elu: round(avg(baselineRows.map((r) => r.elu))) };

  // Phía client (k6), theo từng đoạn.
  const metrics = summary.metrics;
  const phases = setup.phases.map((phase) => {
    const duration = metrics[`http_req_duration{phase:${phase.name}}`]?.values ?? {};
    const failed = metrics[`http_req_failed{phase:${phase.name}}`]?.values ?? {};
    const reqs = metrics[`http_reqs{phase:${phase.name}}`]?.values ?? {};
    return {
      name: phase.name,
      targetVus: phase.target,
      seconds: (phase.endAt - phase.startAt) / 1000,
      requests: reqs.count ?? 0,
      rps: round((reqs.count ?? 0) / ((phase.endAt - phase.startAt) / 1000)),
      p50: round(duration.med),
      p95: round(duration['p(95)']),
      p99: round(duration['p(99)']),
      failRate: round((failed.rate ?? 0) * 100, 2),
    };
  });

  const countLine = readLines(join(OUT, `count-${runData.run}.csv`))[0];
  const [commentCount, realCount, pendingDelta] = (countLine ?? '').split(',').map(Number);
  const countOk = countLine ? commentCount === realCount || commentCount + pendingDelta === realCount : null;
  const pagingBad = (metrics.paging_missing?.values?.count ?? 0) + (metrics.paging_duplicates?.values?.count ?? 0);
  const totalFailRate = round((metrics.http_req_failed?.values?.rate ?? 0) * 100, 2);

  return {
    run: runData.run,
    shape: setup.shape,
    startAt: setup.startAt,
    breakpoints,
    bestRps,
    peak,
    base,
    after,
    recoverySeconds,
    streams,
    memory,
    phases,
    countOk,
    count: { commentCount, realCount, pendingDelta },
    pagingBad,
    totalFailRate,
    timeline,
  };
}

// Trung vị qua các lần: từng số của phần tóm tắt, và từng giây của diễn biến.
function combine(runs) {
  const pick = (fn) => median(runs.map(fn));
  const bp = (key) => {
    const hits = runs.map((r) => r.breakpoints[key]).filter(Boolean);
    return hits.length ? { vus: median(hits.map((h) => h.vus)), s: median(hits.map((h) => h.s)), runs: hits.length, low: Math.min(...hits.map((h) => h.vus)), high: Math.max(...hits.map((h) => h.vus)) } : null;
  };
  const seconds = [...new Set(runs.flatMap((r) => r.timeline.map((row) => row.s)))].sort((a, b) => a - b);
  const fields = ['vus', 'rps', 'p50', 'p95', 'p99', 'err5xx', 'elu', 'inFlight', 'contentWaiting', 'contentInUse', 'heapMB', 'rssMB', 'gcMs', 'hostCpu', 'coreCpu', 'pgCpu', 'k6Cpu', 'pgActive'];
  const byRun = runs.map((r) => new Map(r.timeline.map((row) => [row.s, row])));
  const timeline = seconds.map((s) => {
    const rows = byRun.map((m) => m.get(s)).filter(Boolean);
    const row = { s };
    for (const f of fields) row[f] = round(median(rows.map((r) => r[f])));
    row.lag = Object.fromEntries(STREAM_GROUPS.map((g) => [g, median(rows.map((r) => r.lag?.[g]))]));
    return row;
  });
  return {
    runCount: runs.length,
    breakpoints: Object.fromEntries(Object.keys(runs[0].breakpoints).map((k) => [k, bp(k)])),
    bestRps: { rps: pick((r) => r.bestRps.rps), vus: pick((r) => r.bestRps.vus), low: Math.min(...runs.map((r) => r.bestRps.rps)), high: Math.max(...runs.map((r) => r.bestRps.rps)) },
    peak: Object.fromEntries(Object.keys(runs[0].peak).map((k) => [k, pick((r) => r.peak[k])])),
    base: { p95: pick((r) => r.base.p95), elu: pick((r) => r.base.elu) },
    after: { p95: pick((r) => r.after.p95), elu: pick((r) => r.after.elu), rps: pick((r) => r.after.rps) },
    recoverySeconds: pick((r) => r.recoverySeconds),
    recoveryRange: runs.map((r) => r.recoverySeconds),
    streams: Object.fromEntries(STREAM_GROUPS.map((g) => [g, Object.fromEntries(Object.keys(runs[0].streams[g]).map((k) => [k, pick((r) => r.streams[g][k])]))])),
    memory: Object.fromEntries(Object.keys(runs[0].memory).map((k) => [k, pick((r) => r.memory[k])])),
    phases: runs[0].phases.map((p, i) => Object.fromEntries(Object.keys(p).map((k) => [k, typeof p[k] === 'number' ? pick((r) => r.phases[i][k]) : p[k]]))),
    countOk: runs.every((r) => r.countOk !== false),
    pagingBad: runs.reduce((a, r) => a + r.pagingBad, 0),
    totalFailRate: pick((r) => r.totalFailRate),
    timeline,
  };
}

const files = readdirSync(OUT).filter((f) => /^s-(stress|spike)\.run\d+\.json$/.test(f)).sort();
const runsData = files.map(loadRun).filter((r) => r.setup?.phases);
const probe = loadProbe(runsData.map(({ setup }) => [setup.startAt - 30_000, setup.endAt + 40_000]));
const shapes = {};
for (const shape of ['stress', 'spike']) {
  const runs = runsData.filter((r) => r.setup.shape === shape).map((r) => analyseRun(r, probe)).filter((r) => r.timeline.length > 60);
  if (!runs.length) continue;
  shapes[shape] = { ...combine(runs), runs: runs.map(({ timeline, ...rest }) => rest) };
}
writeFileSync(join(OUT, 'stress-analysis.json'), JSON.stringify({ generatedAt: new Date().toISOString(), shapes }));

const lines = ['# Stress và spike theo số người (trung vị các lần)', ''];
for (const [shape, data] of Object.entries(shapes)) {
  const b = data.breakpoints;
  const fmt = (x) => (x ? `${x.vus} VU (${x.low}–${x.high}, ${x.runs}/${data.runCount} lần)` : 'không chạm');
  lines.push(`## ${shape} (${data.runCount} lần)`, '',
    `- Luồng chính bận ≥ 80%: ${fmt(b.loopBusy80)}; ≥ 95%: ${fmt(b.loopFull)}`,
    `- Hàng chờ pool content ≥ 5: ${fmt(b.poolQueue)}`,
    `- p95 server > ${READ_THRESHOLD_MS} ms: ${fmt(b.p95Over)}; > 1 s: ${fmt(b.p95Over1s)}`,
    `- Lỗi 5xx > 1%: ${fmt(b.errorsOver)}`,
    `- Thông lượng cao nhất giữ 10 s: ${data.bestRps.rps} req/s (${data.bestRps.low}–${data.bestRps.high}) ở khoảng ${data.bestRps.vus} VU`,
    `- Đỉnh ${data.peak.vus} VU: ${data.peak.rps} req/s, p95 ${data.peak.p95} ms, lỗi ${data.peak.errorRate}%, luồng chính ${data.peak.elu}%, chờ kết nối max ${data.peak.contentWaitingMax}, PG ${data.peak.pgActive} phiên chạy, CPU PG ${data.peak.pgCpu}%`,
    `- Hồi phục sau khi hạ tải: ${data.recoverySeconds} s (các lần: ${data.recoveryRange.join(', ')}); sau đó p95 ${data.after.p95} ms, luồng chính ${data.after.elu}% (trước khi dồn tải: p95 ${data.base.p95} ms, ${data.base.elu}%)`,
    `- Heap: trước ${data.memory.heapBefore} MB, đỉnh ${data.memory.heapPeak} MB, cuối ${data.memory.heapAfter} MB; RSS ${data.memory.rssBefore} → ${data.memory.rssPeak} → ${data.memory.rssAfter} MB`,
    ...Object.entries(data.streams).map(([g, s]) => `- Stream ${g}: lag trước ${s.baseline}, cao nhất ${s.max} (ở ~${s.maxAtVus} VU), về lại sau ${s.drainSeconds ?? 'chưa về'} s, cuối ${s.endLag}`),
    `- Số đếm khớp: ${data.countOk ? 'có' : 'KHÔNG'}; phân trang thiếu/lặp: ${data.pagingBad}; lỗi phía k6 cả bài: ${data.totalFailRate}%`,
    '', '| Đoạn | VU cuối | Req/s | p50 | p95 | p99 | Lỗi |', '|---|---:|---:|---:|---:|---:|---:|',
    ...data.phases.map((p) => `| ${p.name} | ${p.targetVus} | ${p.rps} | ${p.p50} | ${p.p95} | ${p.p99} | ${p.failRate}% |`), '');
}
writeFileSync(join(OUT, 'stress-report.md'), lines.join('\n'));
process.stdout.write(lines.join('\n'));
