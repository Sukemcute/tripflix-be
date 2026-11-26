// TF99: phân tích so sánh cấu hình a (1 process all) và b (2 api + 1 worker).
// Đọc cluster-<tag>.txt, probe của từng process, kết quả k6 và res-procs/res-docker/pg/count/stream
// trong out/ (hoặc env BENCH_OUT), gộp số liệu nhiều process theo từng giây rồi xuất:
//   ab-analysis.json và ab-report.md
//   node tools/bench/comments/analyze-ab.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.BENCH_OUT
  ? resolve(process.env.BENCH_OUT)
  : join(dirname(fileURLToPath(import.meta.url)), 'out');

const TAGS = ['a', 'b'];
const CONFIG_LABELS = { a: '1 process (all)', b: '2 api + 1 worker' };
const KIND_ORDER = { read: 0, mixed: 1, write: 2 };
const READ_THRESHOLD_MS = 150;
const ERROR_THRESHOLD = 0.01;
const ROLLING_SECONDS = 5;
// Hồi phục: 10 giây liền p95 dưới ngưỡng, không còn request chờ mượn kết nối và không có 5xx.
const RECOVERY_STABLE_SECONDS = 10;
const STREAM_GROUPS = ['core-analytics', 'core-discovery', 'core-moderation'];

const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const mean = (values) => {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : undefined;
};
const max = (values) => {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? Math.max(...usable) : undefined;
};
function percentile(values, p) {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!usable.length) return undefined;
  const sorted = [...usable].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
const quantile = (values, q) => {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const median = (values) => percentile(values, 0.5);
const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const inWindow = (t, w) => t >= w.start && t <= w.end;
const isApiRole = (role) => role === 'api' || role === 'all';

/** Đọc danh sách process và đường dẫn probe từ cluster-<tag>.txt. */
function loadCluster(tag) {
  const file = join(OUT, `cluster-${tag}.txt`);
  const processes = [];
  for (const line of readLines(file)) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const name = parts[0].trim();
    const role = parts[1].trim();
    const probePath = parts.slice(4).join(',').trim();
    if (!name || !role) continue;
    processes.push({ name, role, probePath: probePath ? resolve(OUT, probePath) : null });
  }
  return processes;
}

/** Đọc và gộp các dòng probe của mọi process theo từng giây (làm tròn t về giây). */
function loadMergedProbes(processes) {
  // Gom theo (giây -> tên process) trước để mỗi process chỉ giữ 1 bản ghi gauge trong giây nếu đồng hồ lệch nhẹ.
  const buckets = new Map();
  for (const proc of processes) {
    if (!proc.probePath || !existsSync(proc.probePath)) continue;
    for (const raw of readLines(proc.probePath)) {
      let row;
      try {
        row = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof row?.t !== 'number') continue;
      const sec = Math.round(row.t / 1000);
      if (!buckets.has(sec)) buckets.set(sec, new Map());
      const procMap = buckets.get(sec);
      if (!procMap.has(proc.name)) {
        procMap.set(proc.name, { proc, rows: [] });
      }
      procMap.get(proc.name).rows.push(row);
    }
  }

  const merged = [];
  const sortedSecs = [...buckets.keys()].sort((a, b) => a - b);
  for (const sec of sortedSecs) {
    const procMap = buckets.get(sec);
    const apiElus = [];
    const workerElus = [];
    const loopP99s = [];
    const loopMaxs = [];
    const eluByProcess = {};
    const server = [];
    const status = {};
    const pools = {};
    const queriesByPool = {};
    const queriesBySignature = {};
    let inFlight = 0;
    let heapMB = 0;
    let rssMB = 0;
    let gcMs = 0;
    let connectWaitMs = 0;
    let connectCount = 0;
    let queryMs = 0;
    let queryCount = 0;

    for (const { proc, rows } of procMap.values()) {
      // Gauge lấy mẫu cuối trong giây (thường chỉ có 1 dòng/giây), counter cộng dồn.
      const last = rows[rows.length - 1];
      const procElu = mean(rows.map((r) => r.elu));
      if (procElu !== undefined) {
        eluByProcess[proc.name] = procElu * 100;
        if (isApiRole(proc.role)) apiElus.push(procElu);
        else if (proc.role === 'worker') workerElus.push(procElu);
      }

      if (isApiRole(proc.role)) {
        if (typeof last.loopP99 === 'number') loopP99s.push(last.loopP99);
        if (typeof last.loopMax === 'number') loopMaxs.push(last.loopMax);
        inFlight += last.inFlight ?? 0;

        for (const r of rows) {
          if (Array.isArray(r.server)) server.push(...r.server);
          for (const [code, count] of Object.entries(r.status ?? {})) {
            status[code] = (status[code] ?? 0) + count;
          }
        }
        for (const [poolName, p] of Object.entries(last.pools ?? {})) {
          const target = (pools[poolName] ??= { total: 0, idle: 0, waiting: 0, max: 0 });
          target.total += p.total ?? 0;
          target.idle += p.idle ?? 0;
          target.waiting += p.waiting ?? 0;
          target.max += p.max ?? 0;
        }
      }

      heapMB += last.heapMB ?? 0;
      rssMB += last.rssMB ?? 0;
      for (const r of rows) {
        gcMs += r.gcMs ?? 0;
        connectWaitMs += r.connectWaitMs ?? 0;
        connectCount += r.connectCount ?? 0;
        queryMs += r.queryMs ?? 0;
        queryCount += r.queryCount ?? 0;
        for (const [key, val] of Object.entries(r.queriesByPool ?? {})) {
          const target = (queriesByPool[key] ??= { count: 0, ms: 0 });
          target.count += val.count ?? 0;
          target.ms += val.ms ?? 0;
        }
        for (const [key, val] of Object.entries(r.queriesBySignature ?? {})) {
          const target = (queriesBySignature[key] ??= { count: 0, ms: 0 });
          target.count += val.count ?? 0;
          target.ms += val.ms ?? 0;
        }
      }
    }

    merged.push({
      t: sec * 1000,
      eluByProcess,
      eluApiAvg: apiElus.length ? mean(apiElus) * 100 : undefined,
      eluApiMax: apiElus.length ? max(apiElus) * 100 : undefined,
      eluWorker: workerElus.length ? mean(workerElus) * 100 : undefined,
      loopP99: max(loopP99s),
      loopMax: max(loopMaxs),
      gcMs,
      heapMB,
      rssMB,
      inFlight,
      server,
      status,
      connectWaitMs,
      connectCount,
      queryMs,
      queryCount,
      pools,
      queriesByPool,
      queriesBySignature,
    });
  }
  return merged;
}

function k6VusMetrics(data) {
  const values = (key) => data.metrics?.[key]?.values;
  const all = values('http_req_duration{step:measure}') ?? {};
  const byName = (name) => {
    const v = values(`http_req_duration{step:measure,name:${name}}`);
    return v?.count ? v : undefined;
  };
  const seconds = data.setup_data?.steps?.measure ?? 60;
  const thresholds = Object.values(data.metrics ?? {}).flatMap((m) => Object.values(m.thresholds ?? {}));
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

function probeVusMetrics(mergedProbes, w) {
  const rows = mergedProbes.filter((row) => inWindow(row.t, w));
  if (!rows.length) return {};
  const server = rows.flatMap((row) => row.server);
  const poolRows = (name) => rows.map((row) => row.pools?.[name]).filter(Boolean);
  const content = poolRows('core-api:content');
  const access = poolRows('core-api:access');
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

  const procNames = new Set(rows.flatMap((r) => Object.keys(r.eluByProcess ?? {})));
  const eluByProcess = {};
  for (const name of procNames) {
    eluByProcess[name] = mean(rows.map((r) => r.eluByProcess?.[name]));
  }

  return {
    eluByProcess,
    eluApiAvg: mean(rows.map((r) => r.eluApiAvg)),
    eluApiMax: mean(rows.map((r) => r.eluApiMax)),
    eluWorker: mean(rows.map((r) => r.eluWorker)),
    loopP99: median(rows.map((r) => r.loopP99)),
    loopMax: max(rows.map((r) => r.loopMax)),
    gcMsPerSec: sum('gcMs') / rows.length,
    heapMax: max(rows.map((r) => r.heapMB)),
    rssMax: max(rows.map((r) => r.rssMB)),
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
    contentPoolMax: max(content.map((p) => p.max)),
    accessInUseMax: max(access.map((p) => p.total - p.idle)),
    accessWaitingMax: max(access.map((p) => p.waiting)),
  };
}

/** Câu truy vấn trong khung đo, tính trên mỗi request HTTP: theo pool (module) và 12 mẫu câu tốn nhiều thời gian nhất. */
function probeDetail(mergedProbes, w) {
  const rows = mergedProbes.filter((row) => inWindow(row.t, w));
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

/** Đọc res-procs-<run>.csv: giờ epoch ms,tên process,CPU cả máy %,CPU process % một nhân,RAM MB. */
function readProcsCsv(run) {
  return readLines(join(OUT, `res-procs-${run}.csv`))
    .map((line) => {
      const c = line.split(',');
      if (c.length < 5) return null;
      const at = Number(c[0]);
      const name = c[1].trim();
      const hostCpu = Number(c[2]);
      const procCpu = Number(c[3]);
      const ramMB = Number(c[4]);
      if (!Number.isFinite(at) || !name) return null;
      return { at, name, hostCpu, procCpu, ramMB };
    })
    .filter(Boolean);
}

function procsVusMetrics(run, processes, w) {
  const rows = readProcsCsv(run).filter((r) => inWindow(r.at, w));
  if (!rows.length) return {};
  const roleByName = new Map(processes.map((p) => [p.name, p.role]));
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  const cpuByProcess = {};
  const apiCpus = [];
  let coreCpuTotal = 0;
  for (const [name, list] of byName.entries()) {
    const avgCpu = mean(list.map((r) => r.procCpu));
    if (avgCpu !== undefined) {
      cpuByProcess[name] = avgCpu;
      coreCpuTotal += avgCpu;
      const role = roleByName.get(name);
      // Nếu thiếu cluster-<tag>.txt thì coi mọi process không phải worker là API.
      if (role ? isApiRole(role) : name !== 'worker') apiCpus.push(avgCpu);
    }
  }
  return {
    cpuByProcess,
    coreCpuTotal,
    cpuApiMax: max(apiCpus),
    hostCpu: mean(rows.map((r) => r.hostCpu)),
    hostCpuP90: percentile(rows.map((r) => r.hostCpu), 0.9),
  };
}

function dockerMetrics(run, w) {
  const rows = readLines(join(OUT, `res-docker-${run}.csv`))
    .map((line) => line.split(','))
    .filter((c) => c.length >= 3 && inWindow(Number(c[0]), w));
  if (!rows.length) return {};
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
  const rows = readLines(join(OUT, `pg-${run}.csv`))
    .map((line) => line.split(',').map(Number))
    .filter((c) => c.length === 8 && inWindow(c[0], w));
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
  if (!row || row.length < 3 || row.some(Number.isNaN)) return {};
  return { countOk: row[0] === row[1] && row[2] === 0 ? 1 : 0 };
}

function analyzeVusForTag(tag, processes, mergedProbes) {
  const files = existsSync(OUT) ? readdirSync(OUT) : [];
  const vusRegex = new RegExp(`^${tag}-v-(read|write|mixed)-(\\d+)\\.run(\\d+)\\.json$`);
  const groups = new Map();

  for (const file of files) {
    const match = vusRegex.exec(file);
    if (!match) continue;
    const [, kind, vus, index] = match;
    const run = `${tag}-v-${kind}-${vus}.run${index}`;
    const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
    const window = { start: data.setup_data?.measureStartAt, end: data.setup_data?.measureEndAt };
    const hasWindow = typeof window.start === 'number' && typeof window.end === 'number';
    const metrics = {
      ...k6VusMetrics(data),
      ...(hasWindow
        ? {
            ...probeVusMetrics(mergedProbes, window),
            ...procsVusMetrics(run, processes, window),
            ...dockerMetrics(run, window),
            ...pgMetrics(run, window),
          }
        : {}),
      ...countCheck(run),
    };
    const key = `${kind}:${vus}`;
    if (!groups.has(key)) groups.set(key, { kind, vus: Number(vus), runs: [] });
    groups.get(key).runs.push({
      index: Number(index),
      metrics,
      detail: hasWindow ? probeDetail(mergedProbes, window) : null,
    });
  }

  return [...groups.values()]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.vus - b.vus)
    .map(({ kind, vus, runs }) => {
      const scalarKeys = new Set(
        runs.flatMap((r) =>
          Object.entries(r.metrics)
            .filter(([, v]) => typeof v !== 'object' || v === null)
            .map(([k]) => k),
        ),
      );
      const medianMetrics = {};
      for (const key of scalarKeys) {
        medianMetrics[key] = round(median(runs.map((r) => r.metrics[key])), 2);
      }

      const mergeNestedMedian = (field) => {
        const names = new Set(runs.flatMap((r) => Object.keys(r.metrics[field] ?? {})));
        const out = {};
        for (const name of names) {
          out[name] = round(median(runs.map((r) => r.metrics[field]?.[name])), 2);
        }
        return out;
      };

      const p95s = runs.map((r) => r.metrics.p95).filter((v) => typeof v === 'number' && Number.isFinite(v));
      return {
        kind,
        vus,
        runCount: runs.length,
        passedRuns: runs.filter((r) => r.metrics.passed).length,
        p95Low: p95s.length ? round(Math.min(...p95s)) : null,
        p95High: p95s.length ? round(Math.max(...p95s)) : null,
        ...medianMetrics,
        eluByProcess: mergeNestedMedian('eluByProcess'),
        cpuByProcess: mergeNestedMedian('cpuByProcess'),
        detail: runs.sort((a, b) => a.index - b.index).find((r) => r.detail)?.detail ?? null,
      };
    });
}

function vusAt(setup, at) {
  let from = setup.startVus ?? 0;
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

function buildStressTimeline({ run, setup }, mergedProbes) {
  const from = setup.startAt - 30_000;
  const to = setup.endAt + 40_000;
  const procs = readProcsCsv(run);
  const docker = readLines(join(OUT, `res-docker-${run}.csv`))
    .map((l) => l.split(','))
    .map(([at, name, cpu]) => ({ at: Number(at), name, cpu: parseFloat(cpu) }));
  const pg = readLines(join(OUT, `pg-${run}.csv`))
    .map((l) => l.split(',').map(Number))
    .map(([at, sessions, active, lock]) => ({ at, sessions, active, lock }));
  const streams = streamRows(run);

  const procsBy = bySecond(procs, setup.startAt, (r) => r);
  const pgBy = bySecond(pg, setup.startAt, (r) => r);
  const dockerBy = bySecond(docker, setup.startAt, (r) => r);
  const streamBy = bySecond(streams, setup.startAt, (r) => r.groups);

  const timeline = [];
  for (const line of mergedProbes) {
    if (line.t < from || line.t > to) continue;
    // Dòng probe ghi lúc cuối giây đo: lùi 500 ms để quy về đúng giây phát sinh tải.
    const at = line.t - 500;
    const second = Math.floor((at - setup.startAt) / 1000);
    const status = line.status ?? {};
    const served = line.server.length;
    const content = line.pools['core-api:content'] ?? {};
    const procRows = procsBy.get(second) ?? [];
    const pgRows = pgBy.get(second) ?? [];
    const dockerRows = dockerBy.get(second) ?? [];
    const streamGroups = (streamBy.get(second) ?? [])[0];
    const dockerCpu = (needle) => mean(dockerRows.filter((r) => r.name.includes(needle)).map((r) => r.cpu)) ?? null;

    // Cộng trung bình CPU của từng process trong giây để ra tổng CPU core-api.
    const procNames = [...new Set(procRows.map((r) => r.name))];
    const coreCpu = procNames.length
      ? procNames.reduce((sum, name) => sum + (mean(procRows.filter((r) => r.name === name).map((r) => r.procCpu)) ?? 0), 0)
      : null;

    timeline.push({
      s: second,
      vus: at < setup.startAt ? (setup.startVus ?? 0) : vusAt(setup, at),
      rps: served,
      p50: quantile(line.server, 0.5),
      p95: quantile(line.server, 0.95),
      p99: quantile(line.server, 0.99),
      err5xx: status['5xx'] ?? 0,
      eluApiAvg: line.eluApiAvg !== undefined ? Math.round(line.eluApiAvg) : null,
      eluApiMax: line.eluApiMax !== undefined ? Math.round(line.eluApiMax) : null,
      eluWorker: line.eluWorker !== undefined ? Math.round(line.eluWorker) : null,
      inFlight: line.inFlight,
      contentWaiting: content.waiting ?? 0,
      contentInUse: (content.total ?? 0) - (content.idle ?? 0),
      connectWaitAvg: line.connectCount ? round(line.connectWaitMs / line.connectCount) : 0,
      heapMB: line.heapMB,
      rssMB: line.rssMB,
      gcMs: line.gcMs,
      hostCpu: mean(procRows.map((r) => r.hostCpu)) ?? null,
      coreCpu,
      pgCpu: dockerCpu('postgres'),
      k6Cpu: dockerCpu('tf99-k6'),
      pgActive: mean(pgRows.map((r) => r.active)) ?? null,
      pgLock: mean(pgRows.map((r) => r.lock)) ?? null,
      lag: streamGroups ? Object.fromEntries(STREAM_GROUPS.map((g) => [g, streamGroups[g]?.lag ?? null])) : null,
      pending: streamGroups ? Object.fromEntries(STREAM_GROUPS.map((g) => [g, streamGroups[g]?.pending ?? null])) : null,
    });
  }
  timeline.sort((a, b) => a.s - b.s);
  return timeline;
}

function rolling(timeline, index, pick, seconds = ROLLING_SECONDS) {
  return mean(timeline.slice(Math.max(0, index - seconds + 1), index + 1).map(pick)) ?? null;
}

function rollingErrorRate(timeline, index, seconds = ROLLING_SECONDS) {
  const window = timeline.slice(Math.max(0, index - seconds + 1), index + 1);
  const served = window.reduce((a, r) => a + r.rps, 0);
  return served ? window.reduce((a, r) => a + r.err5xx, 0) / served : 0;
}

function analyseStressRun(runData, mergedProbes) {
  const { setup, summary } = runData;
  const peakPhase = setup.phases.find((p) => p.name === 'hold' || p.name === 'peak');
  const down = setup.phases.find((p) => p.name === 'down');
  if (!peakPhase || !down) return null;

  const timeline = buildStressTimeline(runData, mergedProbes);
  if (!timeline.length) return null;

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
  // Dùng eluApiMax để phát hiện điểm nghẽn ngay khi process API bận nhất chạm ngưỡng.
  const breakpoints = {
    loopBusy80: firstCross((i) => (rolling(timeline, i, (r) => r.eluApiMax) ?? 0) >= 80),
    loopFull: firstCross((i) => (rolling(timeline, i, (r) => r.eluApiMax) ?? 0) >= 95),
    poolQueue: firstCross((i) => (rolling(timeline, i, (r) => r.contentWaiting) ?? 0) >= 5),
    p95Over: firstCross((i) => (rolling(timeline, i, (r) => r.p95 ?? 0) ?? 0) > READ_THRESHOLD_MS),
    p95Over1s: firstCross((i) => (rolling(timeline, i, (r) => r.p95 ?? 0) ?? 0) > 1000),
    errorsOver: firstCross((i) => rollingErrorRate(timeline, i) > ERROR_THRESHOLD),
  };

  let bestRps = { rps: 0, s: null, vus: null };
  for (let i = 0; i < timeline.length; i++) {
    const value = rolling(timeline, i, (r) => r.rps, 10);
    if (value !== null && value > bestRps.rps && timeline[i].s >= 0) {
      bestRps = { rps: round(value), s: timeline[i].s, vus: timeline[i].vus };
    }
  }

  const inPhase = (phase) => timeline.filter((r) => r.s >= secondOf(phase.startAt) && r.s < secondOf(phase.endAt));
  const peakRows = inPhase(peakPhase);
  const peakServed = peakRows.reduce((a, r) => a + r.rps, 0);
  const peak = {
    vus: peakPhase.target,
    rps: round(mean(peakRows.map((r) => r.rps))),
    p95: round(median(peakRows.map((r) => r.p95))),
    errorRate: peakServed ? round((peakRows.reduce((a, r) => a + r.err5xx, 0) / peakServed) * 100, 2) : null,
    eluApiAvg: round(mean(peakRows.map((r) => r.eluApiAvg))),
    eluApiMax: round(mean(peakRows.map((r) => r.eluApiMax))),
    eluWorker: round(mean(peakRows.map((r) => r.eluWorker))),
    contentWaitingMax: peakRows.length ? Math.max(0, ...peakRows.map((r) => r.contentWaiting)) : null,
    inFlightMax: peakRows.length ? Math.max(0, ...peakRows.map((r) => r.inFlight)) : null,
    pgCpu: round(mean(peakRows.map((r) => r.pgCpu))),
    pgActive: round(mean(peakRows.map((r) => r.pgActive))),
    coreCpu: round(mean(peakRows.map((r) => r.coreCpu))),
    k6Cpu: round(mean(peakRows.map((r) => r.k6Cpu))),
    hostCpu: round(mean(peakRows.map((r) => r.hostCpu))),
  };

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

  const streams = {};
  for (const group of STREAM_GROUPS) {
    const lagOf = (r) => r.lag?.[group];
    const baseline = median(before.map(lagOf)) ?? 0;
    const withLag = timeline.filter((r) => Number.isFinite(lagOf(r)));
    const maxRow = withLag.reduce((best, r) => (lagOf(r) > (lagOf(best) ?? -1) ? r : best), withLag[0] ?? null);
    let drainedAt = null;
    for (const r of withLag) {
      if (r.s >= downEnd && lagOf(r) <= baseline + 10) {
        drainedAt = r.s;
        break;
      }
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
    heapBefore: median(before.map((r) => r.heapMB)) ?? median(loadPart.slice(0, 30).map((r) => r.heapMB)) ?? null,
    heapPeak: Math.max(0, ...timeline.map((r) => r.heapMB)),
    heapAfter: median(tail.map((r) => r.heapMB)) ?? null,
    rssBefore: median(before.map((r) => r.rssMB)) ?? median(loadPart.slice(0, 30).map((r) => r.rssMB)) ?? null,
    rssPeak: Math.max(0, ...timeline.map((r) => r.rssMB)),
    rssAfter: median(tail.map((r) => r.rssMB)) ?? null,
  };

  const afterRows = afterRecovery.length ? afterRecovery : tail;
  const after = {
    p95: round(median(afterRows.map((r) => r.p95))),
    eluApiAvg: round(mean(afterRows.map((r) => r.eluApiAvg))),
    eluApiMax: round(mean(afterRows.map((r) => r.eluApiMax))),
    rps: round(mean(afterRows.map((r) => r.rps))),
  };
  const baselineRows = timeline.filter((r) => r.s >= 0 && r.vus <= 60 && r.s < secondOf(down.startAt));
  const base = {
    p95: round(median(baselineRows.map((r) => r.p95))),
    eluApiAvg: round(mean(baselineRows.map((r) => r.eluApiAvg))),
    eluApiMax: round(mean(baselineRows.map((r) => r.eluApiMax))),
  };

  const metrics = summary.metrics ?? {};
  const phases = setup.phases.map((phase) => {
    const duration = metrics[`http_req_duration{phase:${phase.name}}`]?.values ?? {};
    const failed = metrics[`http_req_failed{phase:${phase.name}}`]?.values ?? {};
    const reqs = metrics[`http_reqs{phase:${phase.name}}`]?.values ?? {};
    const secs = (phase.endAt - phase.startAt) / 1000;
    return {
      name: phase.name,
      targetVus: phase.target,
      seconds: secs,
      requests: reqs.count ?? 0,
      rps: secs ? round((reqs.count ?? 0) / secs) : null,
      p50: round(duration.med),
      p95: round(duration['p(95)']),
      p99: round(duration['p(99)']),
      failRate: round((failed.rate ?? 0) * 100, 2),
    };
  });

  const countLine = readLines(join(OUT, `count-${runData.run}.csv`))[0];
  const [commentCount, realCount, pendingDelta] = countLine ? countLine.split(',').map(Number) : [];
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
    count: countLine ? { commentCount, realCount, pendingDelta } : null,
    pagingBad,
    totalFailRate,
    timeline,
  };
}

function combineStressRuns(runs) {
  const pick = (fn) => round(median(runs.map(fn)));
  const bp = (key) => {
    const hits = runs.map((r) => r.breakpoints[key]).filter(Boolean);
    return hits.length
      ? {
          vus: round(median(hits.map((h) => h.vus)), 0),
          s: round(median(hits.map((h) => h.s)), 0),
          runs: hits.length,
          low: Math.min(...hits.map((h) => h.vus)),
          high: Math.max(...hits.map((h) => h.vus)),
        }
      : null;
  };
  const seconds = [...new Set(runs.flatMap((r) => r.timeline.map((row) => row.s)))].sort((a, b) => a - b);
  const fields = [
    'vus',
    'rps',
    'p50',
    'p95',
    'p99',
    'err5xx',
    'eluApiAvg',
    'eluApiMax',
    'eluWorker',
    'inFlight',
    'contentWaiting',
    'contentInUse',
    'heapMB',
    'rssMB',
    'gcMs',
    'hostCpu',
    'coreCpu',
    'pgCpu',
    'k6Cpu',
    'pgActive',
  ];
  const byRun = runs.map((r) => new Map(r.timeline.map((row) => [row.s, row])));
  const timeline = seconds.map((s) => {
    const rows = byRun.map((m) => m.get(s)).filter(Boolean);
    const row = { s };
    for (const f of fields) row[f] = round(median(rows.map((r) => r[f])));
    row.lag = Object.fromEntries(STREAM_GROUPS.map((g) => [g, round(median(rows.map((r) => r.lag?.[g])))]));
    return row;
  });

  const bestRpsVals = runs.map((r) => r.bestRps.rps).filter((v) => typeof v === 'number');
  return {
    runCount: runs.length,
    breakpoints: Object.fromEntries(Object.keys(runs[0].breakpoints).map((k) => [k, bp(k)])),
    bestRps: {
      rps: pick((r) => r.bestRps.rps),
      vus: pick((r) => r.bestRps.vus),
      low: bestRpsVals.length ? Math.min(...bestRpsVals) : null,
      high: bestRpsVals.length ? Math.max(...bestRpsVals) : null,
    },
    peak: Object.fromEntries(Object.keys(runs[0].peak).map((k) => [k, pick((r) => r.peak[k])])),
    base: Object.fromEntries(Object.keys(runs[0].base).map((k) => [k, pick((r) => r.base[k])])),
    after: Object.fromEntries(Object.keys(runs[0].after).map((k) => [k, pick((r) => r.after[k])])),
    recoverySeconds: pick((r) => r.recoverySeconds),
    recoveryRange: runs.map((r) => r.recoverySeconds),
    streams: Object.fromEntries(
      STREAM_GROUPS.map((g) => [g, Object.fromEntries(Object.keys(runs[0].streams[g]).map((k) => [k, pick((r) => r.streams[g][k])]))]),
    ),
    memory: Object.fromEntries(Object.keys(runs[0].memory).map((k) => [k, pick((r) => r.memory[k])])),
    phases: runs[0].phases.map((p, i) =>
      Object.fromEntries(Object.keys(p).map((k) => [k, typeof p[k] === 'number' ? pick((r) => r.phases[i]?.[k]) : p[k]])),
    ),
    countOk: runs.every((r) => r.countOk !== false),
    pagingBad: runs.reduce((a, r) => a + r.pagingBad, 0),
    totalFailRate: pick((r) => r.totalFailRate),
    timeline,
  };
}

function analyzeStressForTag(tag, mergedProbes) {
  const files = existsSync(OUT) ? readdirSync(OUT) : [];
  const stressRegex = new RegExp(`^${tag}-s-(stress|spike)\\.run(\\d+)\\.json$`);
  const runsData = files
    .filter((f) => stressRegex.test(f))
    .sort()
    .map((file) => {
      const summary = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
      const shape = stressRegex.exec(file)?.[1];
      const setup = summary.setup_data ? { shape, ...summary.setup_data } : null;
      return { run: file.replace(/\.json$/, ''), summary, setup };
    })
    .filter((r) => r.setup?.phases);

  const shapes = {};
  for (const shape of ['stress', 'spike']) {
    const runs = runsData
      .filter((r) => r.setup.shape === shape)
      .map((r) => analyseStressRun(r, mergedProbes))
      .filter(Boolean);
    if (!runs.length) continue;
    shapes[shape] = { ...combineStressRuns(runs), runs: runs.map(({ timeline, ...rest }) => rest) };
  }
  return shapes;
}

const fmt = (v, d = 0) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
const pair = (a, b, d = 0, suffix = '') => {
  const sa = a === null || a === undefined ? '–' : `${Number(a).toFixed(d)}${suffix}`;
  const sb = b === null || b === undefined ? '–' : `${Number(b).toFixed(d)}${suffix}`;
  return `${sa} / ${sb}`;
};

function formatEluCell(row) {
  if (!row) return '–';
  if (row.eluApiAvg === null || row.eluApiAvg === undefined) return '–';
  if (row.eluApiMax !== null && row.eluApiMax !== undefined && row.eluApiAvg !== row.eluApiMax) {
    return `${fmt(row.eluApiAvg)}·${fmt(row.eluApiMax)}%`;
  }
  return `${fmt(row.eluApiAvg)}%`;
}

function formatStressSection(title, dataA, dataB) {
  const lines = [`## ${title} (đặt cạnh nhau)`, ''];
  if (!dataA && !dataB) {
    lines.push('Chưa có dữ liệu.', '');
    return lines;
  }
  const fmtBp = (bp, total) => (bp ? `${bp.vus} VU (${bp.low}–${bp.high}, ${bp.runs}/${total} lần)` : 'không chạm');
  const rows = [
    ['Số lần chạy', dataA?.runCount ?? '–', dataB?.runCount ?? '–'],
    ['Luồng chính ≥ 80%', dataA ? fmtBp(dataA.breakpoints.loopBusy80, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.loopBusy80, dataB.runCount) : '–'],
    ['Luồng chính ≥ 95%', dataA ? fmtBp(dataA.breakpoints.loopFull, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.loopFull, dataB.runCount) : '–'],
    ['Hàng chờ pool ≥ 5', dataA ? fmtBp(dataA.breakpoints.poolQueue, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.poolQueue, dataB.runCount) : '–'],
    [`p95 server > ${READ_THRESHOLD_MS} ms`, dataA ? fmtBp(dataA.breakpoints.p95Over, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.p95Over, dataB.runCount) : '–'],
    ['p95 server > 1 s', dataA ? fmtBp(dataA.breakpoints.p95Over1s, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.p95Over1s, dataB.runCount) : '–'],
    ['Lỗi 5xx > 1%', dataA ? fmtBp(dataA.breakpoints.errorsOver, dataA.runCount) : '–', dataB ? fmtBp(dataB.breakpoints.errorsOver, dataB.runCount) : '–'],
    ['Throughput đỉnh (10 s)', dataA ? `${fmt(dataA.bestRps.rps)} req/s @ ${fmt(dataA.bestRps.vus)} VU` : '–', dataB ? `${fmt(dataB.bestRps.rps)} req/s @ ${fmt(dataB.bestRps.vus)} VU` : '–'],
    ['Đỉnh: RPS / p95 / lỗi', dataA ? `${fmt(dataA.peak.rps)} / ${fmt(dataA.peak.p95)} ms / ${fmt(dataA.peak.errorRate, 2)}%` : '–', dataB ? `${fmt(dataB.peak.rps)} / ${fmt(dataB.peak.p95)} ms / ${fmt(dataB.peak.errorRate, 2)}%` : '–'],
    ['Đỉnh: ELU API (avg/max) · worker', dataA ? `${fmt(dataA.peak.eluApiAvg)}/${fmt(dataA.peak.eluApiMax)}% · ${fmt(dataA.peak.eluWorker)}%` : '–', dataB ? `${fmt(dataB.peak.eluApiAvg)}/${fmt(dataB.peak.eluApiMax)}% · ${fmt(dataB.peak.eluWorker)}%` : '–'],
    ['Đỉnh: CPU core tổng / chờ pool / PG active', dataA ? `${fmt(dataA.peak.coreCpu)}% / ${fmt(dataA.peak.contentWaitingMax)} / ${fmt(dataA.peak.pgActive, 1)}` : '–', dataB ? `${fmt(dataB.peak.coreCpu)}% / ${fmt(dataB.peak.contentWaitingMax)} / ${fmt(dataB.peak.pgActive, 1)}` : '–'],
    ['Hồi phục sau hạ tải', dataA ? `${dataA.recoverySeconds ?? '–'} s (${dataA.recoveryRange.map((x) => x ?? '–').join(', ')})` : '–', dataB ? `${dataB.recoverySeconds ?? '–'} s (${dataB.recoveryRange.map((x) => x ?? '–').join(', ')})` : '–'],
    ['Heap / RSS đỉnh (MB)', dataA ? `${fmt(dataA.memory.heapPeak)} / ${fmt(dataA.memory.rssPeak)}` : '–', dataB ? `${fmt(dataB.memory.heapPeak)} / ${fmt(dataB.memory.rssPeak)}` : '–'],
    ['Số đếm khớp / phân trang lỗi / lỗi k6', dataA ? `${dataA.countOk ? 'có' : 'KHÔNG'} / ${dataA.pagingBad} / ${fmt(dataA.totalFailRate, 2)}%` : '–', dataB ? `${dataB.countOk ? 'có' : 'KHÔNG'} / ${dataB.pagingBad} / ${fmt(dataB.totalFailRate, 2)}%` : '–'],
  ];
  lines.push('| Chỉ số | A (1 process all) | B (2 api + 1 worker) |', '|---|---|---|');
  for (const [label, va, vb] of rows) lines.push(`| ${label} | ${va} | ${vb} |`);
  lines.push('');
  return lines;
}

function buildReport(output) {
  const { a, b } = output.configs;
  const lines = [
    '# So sánh cấu hình A / B (TF99)',
    '',
    `- **A**: ${a.label} (${a.processes.map((p) => `${p.name}:${p.role}`).join(', ') || 'chưa có cluster-a.txt'})`,
    `- **B**: ${b.label} (${b.processes.map((p) => `${p.name}:${p.role}`).join(', ') || 'chưa có cluster-b.txt'})`,
    '',
  ];

  for (const kind of ['read', 'mixed', 'write']) {
    const aRows = a.levels.filter((l) => l.kind === kind);
    const bRows = b.levels.filter((l) => l.kind === kind);
    const allVus = [...new Set([...aRows, ...bRows].map((r) => r.vus))].sort((x, y) => x - y);
    if (!allVus.length) continue;

    lines.push(`## Theo mức VU — ${kind} (A / B)`, '');
    lines.push(
      '| VU | RPS (A / B) | p95 k6 ms (A / B) | Lỗi % (A / B) | ELU API (A / B avg·max) | ELU worker (B) | CPU tổng % (A / B) | Chờ kết nối max (A / B) | PG active (A / B) |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const vus of allVus) {
      const ra = aRows.find((r) => r.vus === vus);
      const rb = bRows.find((r) => r.vus === vus);
      lines.push(
        `| ${vus} | ${pair(ra?.rps, rb?.rps, 1)} | ${pair(ra?.p95, rb?.p95, 1)} | ${pair(ra?.failRate, rb?.failRate, 2)} | ${formatEluCell(ra)} / ${formatEluCell(rb)} | ${rb?.eluWorker !== null && rb?.eluWorker !== undefined ? `${fmt(rb.eluWorker)}%` : '–'} | ${pair(ra?.coreCpuTotal, rb?.coreCpuTotal, 1)} | ${pair(ra?.contentWaitingMax, rb?.contentWaitingMax, 0)} | ${pair(ra?.pgActiveAvg, rb?.pgActiveAvg, 1)} |`,
      );
    }
    lines.push('');
  }

  lines.push(...formatStressSection('Stress', a.stress, b.stress));
  if (a.spike || b.spike) {
    lines.push(...formatStressSection('Spike', a.spike, b.spike));
  }
  return lines.join('\n');
}

const configs = {};
for (const tag of TAGS) {
  const processes = loadCluster(tag);
  const mergedProbes = loadMergedProbes(processes);
  const levels = analyzeVusForTag(tag, processes, mergedProbes);
  const stressShapes = analyzeStressForTag(tag, mergedProbes);
  configs[tag] = {
    label: CONFIG_LABELS[tag],
    processes: processes.map(({ name, role }) => ({ name, role })),
    levels,
    stress: stressShapes.stress ?? null,
    ...(stressShapes.spike ? { spike: stressShapes.spike } : {}),
  };
}

const result = { generatedAt: new Date().toISOString(), configs };
writeFileSync(join(OUT, 'ab-analysis.json'), JSON.stringify(result, null, 2));

const report = buildReport(result);
writeFileSync(join(OUT, 'ab-report.md'), `${report}\n`);
process.stdout.write(`${report}\n`);
