// TF99: gom kết quả trong out/ (tóm tắt k6, mẫu khoá, thống kê bảng) thành out/summary.md.
// Mỗi kịch bản chạy nhiều lần (<tên>.run<N>.json): bảng lấy trung vị qua các lần, kèm khoảng p95 thấp nhất – cao nhất.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const RUN_FILE = /^((?:r1|w1)-[\w-]+)\.run(\d+)\.json$/;

const fixed = (value, digits = 1) => (value === undefined || Number.isNaN(value) ? '–' : value.toFixed(digits));

function median(values) {
  const sorted = values.filter((v) => v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readTables(file) {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return Object.fromEntries(
    rows.map((row) => {
      const [table, seq, idx, inserted] = row.split(',');
      return [table, { scans: Number(seq) + Number(idx), seqScans: Number(seq), inserted: Number(inserted) }];
    }),
  );
}

function readLocks(file) {
  if (!existsSync(file)) return null;
  const samples = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((row) => row.split(','))
    .filter((cols) => cols.length === 4 && /^\d/.test(cols[1]))
    .map(([, waiting, active]) => ({ waiting: Number(waiting), active: Number(active) }));
  const busy = samples.filter((s) => s.active > 0);
  if (busy.length === 0) return null;
  return {
    lockShare: busy.filter((s) => s.waiting > 0).length / busy.length,
    avgWaiting: busy.reduce((sum, s) => sum + s.waiting, 0) / busy.length,
    maxWaiting: Math.max(...busy.map((s) => s.waiting)),
    maxActive: Math.max(...busy.map((s) => s.active)),
  };
}

/** Số liệu từng bậc (tag step) của một lượt k6. Chỉ lấy nhóm step: nhóm khác (expected_response...) trùng request. */
function readSteps(data) {
  const durations = data.setup_data?.steps ?? {};
  const steps = {};
  for (const [metric, value] of Object.entries(data.metrics)) {
    const match = /^http_req_duration\{step:(.+)\}$/.exec(metric);
    if (!match) continue;
    const step = match[1];
    const v = value.values;
    const dropped = data.metrics[`dropped_iterations{step:${step}}`]?.values.count ?? 0;
    steps[step] = {
      count: v.count ?? 0,
      rps: durations[step] ? (v.count ?? 0) / durations[step] : undefined,
      p50: v.med,
      p95: v['p(95)'],
      p99: v['p(99)'],
      dropped,
      ok: value.thresholds ? Object.values(value.thresholds).every((r) => r.ok) : undefined,
      rule: value.thresholds ? Object.keys(value.thresholds).join(', ') : '',
    };
  }
  return steps;
}

const groups = new Map();
for (const file of readdirSync(OUT)) {
  const match = RUN_FILE.exec(file);
  if (!match) continue;
  const [, name, run] = match;
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push({ run: `${name}.run${run}`, data: JSON.parse(readFileSync(join(OUT, file), 'utf8')) });
}

const lines = ['# Kết quả benchmark bình luận (TF99)', '', `Tạo lúc ${new Date().toISOString()}`, ''];
lines.push('Mỗi ô là trung vị qua các lần chạy; "p95 thấp–cao" cho thấy độ lệch giữa các lần.', '');

for (const [name, runs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  runs.sort((a, b) => a.run.localeCompare(b.run, undefined, { numeric: true }));
  const perRun = runs.map(({ data }) => readSteps(data));
  const stepNames = Object.keys(perRun[0] ?? {}).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));

  lines.push(`## ${name} (${runs.length} lần)`, '');
  lines.push('| Bậc | Request/giây | p50 (ms) | p95 (ms) | p95 thấp–cao | p99 (ms) | Lượt bị bỏ | Đạt ngưỡng |', '|---|---:|---:|---:|---:|---:|---:|---|');
  for (const step of stepNames) {
    const values = perRun.map((steps) => steps[step]).filter(Boolean);
    const p95s = values.map((v) => v.p95);
    const passed = values.filter((v) => v.ok).length;
    lines.push(
      `| ${step} | ${fixed(median(values.map((v) => v.rps)), 0)} | ${fixed(median(values.map((v) => v.p50)))} | ${fixed(median(p95s))} | ${fixed(Math.min(...p95s), 0)}–${fixed(Math.max(...p95s), 0)} | ${fixed(median(values.map((v) => v.p99)))} | ${fixed(median(values.map((v) => v.dropped)), 0)} | ${passed}/${values.length} lần ${values[0]?.rule ?? ''} |`,
    );
  }

  const failRates = runs
    .map(({ data }) => Object.entries(data.metrics).find(([m]) => m.startsWith('http_req_failed{name:'))?.[1]?.values.rate)
    .filter((rate) => rate !== undefined);
  if (failRates.length) lines.push('', `Tỉ lệ lỗi (cao nhất qua các lần): ${(Math.max(...failRates) * 100).toFixed(2)}%`);

  const pagination = runs[0].data.setup_data?.pagination;
  if (pagination) {
    lines.push('', `Phân trang: ${pagination.pages} trang, total ${pagination.total}, đi hết thấy ${pagination.seen}, thiếu ${pagination.missing}, lặp ${pagination.duplicates}.`);
  }

  // Lượt quét bảng chia cho số request của các bậc đo (bỏ lượt đăng nhập và đi trang trong setup), trung vị qua các lần.
  const tableStats = {};
  runs.forEach(({ run }, index) => {
    const before = readTables(join(OUT, `tables-${run}-before.csv`));
    const after = readTables(join(OUT, `tables-${run}-after.csv`));
    const requests = Object.values(perRun[index]).reduce((sum, s) => sum + s.count, 0);
    if (!before || !after || !requests) return;
    for (const table of Object.keys(after)) {
      tableStats[table] ??= { scans: [], seqScans: [], inserted: [] };
      tableStats[table].scans.push((after[table].scans - (before[table]?.scans ?? 0)) / requests);
      tableStats[table].seqScans.push((after[table].seqScans - (before[table]?.seqScans ?? 0)) / requests);
      tableStats[table].inserted.push(after[table].inserted - (before[table]?.inserted ?? 0));
    }
  });
  if (Object.keys(tableStats).length) {
    lines.push('', '| Bảng | Lượt quét mỗi request | Quét tuần tự mỗi request | Dòng thêm mỗi lần |', '|---|---:|---:|---:|');
    for (const [table, stats] of Object.entries(tableStats)) {
      lines.push(`| ${table} | ${fixed(median(stats.scans), 2)} | ${fixed(median(stats.seqScans), 2)} | ${fixed(median(stats.inserted), 0)} |`);
    }
  }

  const locks = runs.map(({ run }) => readLocks(join(OUT, `locks-${run}.csv`))).filter(Boolean);
  if (locks.length) {
    lines.push(
      '',
      `Chờ khoá (mẫu 100 ms, chỉ tính lúc có phiên chạy, trung vị qua các lần): ${fixed(median(locks.map((l) => l.lockShare * 100)), 0)}% mẫu có phiên chờ khoá, trung bình ${fixed(median(locks.map((l) => l.avgWaiting)))} phiên chờ, tối đa ${Math.max(...locks.map((l) => l.maxWaiting))} phiên chờ, tối đa ${Math.max(...locks.map((l) => l.maxActive))} phiên chạy cùng lúc.`,
    );
  }
  lines.push('');
}

// Chế độ vus (levels.js): mỗi file v-<kiểu>-<số VU>.run<N>.json là một lượt, chỉ tính bậc "measure" (bỏ khởi động).
const VUS_FILE = /^v-(read|write|mixed)-(\d+)\.run(\d+)\.json$/;
const KIND_TITLES = { read: 'R · đọc', mixed: 'M · hỗn hợp (80% đọc, 15% gửi, 5% mở trả lời)', write: 'W · gửi bình luận' };

function readCsvRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((row) => row.split(','));
}

/** CPU trung vị và p90 của một lượt, chỉ lấy các mẫu có tải: trung vị để lúc setup, teardown đi hết trang không làm lệch. */
function readCpu(file, column) {
  const values = readCsvRows(file)
    .map((cols) => Number(String(cols[column] ?? '').replace('%', '')))
    .filter((v) => Number.isFinite(v) && v > 5);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: median(sorted), p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] };
}

function readMeasure(data) {
  const metric = (key) => data.metrics[key]?.values;
  const all = metric('http_req_duration{step:measure}') ?? {};
  const failed = metric('http_req_failed{step:measure}');
  const byName = (name) => {
    const values = metric(`http_req_duration{step:measure,name:${name}}`);
    return values?.count ? values : undefined;
  };
  const thresholds = Object.values(data.metrics).flatMap((m) => Object.values(m.thresholds ?? {}));
  return {
    rps: (all.count ?? 0) / (data.setup_data?.steps?.measure ?? 60),
    p50: all.med,
    p95: all['p(95)'],
    p99: all['p(99)'],
    readP95: byName('read')?.['p(95)'],
    writeP95: byName('write')?.['p(95)'],
    repliesP95: byName('replies')?.['p(95)'],
    failRate: failed?.rate ?? 0,
    pagingMissing: metric('paging_missing')?.count,
    pagingDuplicates: metric('paging_duplicates')?.count,
    ok: thresholds.every((r) => r.ok),
  };
}

const vusRuns = new Map();
for (const file of readdirSync(OUT)) {
  const match = VUS_FILE.exec(file);
  if (!match) continue;
  const [, kind, vus, run] = match;
  const key = `${kind}:${vus}`;
  if (!vusRuns.has(key)) vusRuns.set(key, { kind, vus: Number(vus), runs: [] });
  const runName = `v-${kind}-${vus}.run${run}`;
  vusRuns.get(key).runs.push({
    measure: readMeasure(JSON.parse(readFileSync(join(OUT, file), 'utf8'))),
    coreCpu: readCpu(join(OUT, `cpu-core-${runName}.csv`), 1),
    pgCpu: readCpu(join(OUT, `cpu-pg-${runName}.csv`), 1),
    locks: readLocks(join(OUT, `locks-${runName}.csv`)),
    count: readCsvRows(join(OUT, `count-${runName}.csv`))[0]?.map(Number),
  });
}

if (vusRuns.size) {
  lines.push('# Đo theo số VU (mỗi VU nghỉ 1–3 s, đo 60 s sau 10 s khởi động)', '');
  for (const kind of ['read', 'mixed', 'write']) {
    const levels = [...vusRuns.values()].filter((g) => g.kind === kind).sort((a, b) => a.vus - b.vus);
    if (levels.length === 0) continue;
    lines.push(`## ${KIND_TITLES[kind]}`, '');
    lines.push(
      '| VU | Lần | Request/giây | p50 (ms) | p95 (ms) | p95 thấp–cao | p99 (ms) | p95 đọc / gửi / trả lời | Lỗi cao nhất | CPU core-api trung vị / p90 (% 1 nhân) | CPU Postgres trung vị | Chờ khoá | Đếm & phân trang | Đạt ngưỡng |',
      '|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---|---|',
    );
    for (const { vus, runs } of levels) {
      const m = runs.map((r) => r.measure);
      const p95s = m.map((v) => v.p95).filter((v) => v !== undefined);
      const med = (pick) => median(m.map(pick));
      const cores = runs.map((r) => r.coreCpu).filter(Boolean);
      const pgs = runs.map((r) => r.pgCpu).filter(Boolean);
      const locks = runs.map((r) => r.locks).filter(Boolean);
      const counts = runs.map((r) => r.count).filter(Boolean);
      const countOk = counts.every(([stored, actual, pending]) => stored === actual && pending === 0);
      const pagingBad = m.reduce((sum, v) => sum + (v.pagingMissing ?? 0) + (v.pagingDuplicates ?? 0), 0);
      const integrity = kind === 'read' ? '–' : `${counts.length ? (countOk ? 'khớp' : 'LỆCH') : '?'}, ${pagingBad === 0 ? 'đủ trang' : `thiếu/lặp ${pagingBad}`}`;
      const split = [med((v) => v.readP95), med((v) => v.writeP95), med((v) => v.repliesP95)].map((v) => fixed(v, 0)).join(' / ');
      lines.push(
        `| ${vus} | ${runs.length} | ${fixed(med((v) => v.rps), 0)} | ${fixed(med((v) => v.p50))} | ${fixed(median(p95s))} | ${fixed(Math.min(...p95s), 0)}–${fixed(Math.max(...p95s), 0)} | ${fixed(med((v) => v.p99))} | ${split} | ${(Math.max(...m.map((v) => v.failRate)) * 100).toFixed(2)}% | ${cores.length ? `${fixed(median(cores.map((c) => c.median)), 0)} / ${fixed(median(cores.map((c) => c.p90)), 0)}` : '–'} | ${pgs.length ? `${fixed(median(pgs.map((c) => c.median)), 0)}%` : '–'} | ${locks.length ? `${fixed(median(locks.map((l) => l.lockShare * 100)), 0)}%` : '–'} | ${integrity} | ${m.filter((v) => v.ok).length}/${m.length} |`,
      );
    }
    lines.push('');
  }
  lines.push('Ngưỡng: đọc và mở trả lời p95 < 150 ms, gửi p95 < 300 ms, lỗi < 1%, sau lượt ghi comment_count khớp và đi hết trang không thiếu, không lặp.', '');
}

writeFileSync(join(OUT, 'summary.md'), `${lines.join('\n')}\n`);
process.stdout.write(lines.join('\n'));
