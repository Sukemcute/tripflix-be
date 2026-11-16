// TF99: gom kết quả trong out/ (tóm tắt k6, mẫu khoá, thống kê bảng) thành out/summary.md.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const ms = (value) => (value === undefined ? '–' : value.toFixed(1));

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
    .map(([, waiting, active, idleInTx]) => ({ waiting: Number(waiting), active: Number(active), idleInTx: Number(idleInTx) }));
  if (samples.length === 0) return null;
  const busy = samples.filter((s) => s.active > 0);
  return {
    samples: samples.length,
    maxWaiting: Math.max(...samples.map((s) => s.waiting)),
    avgWaitingWhenBusy: busy.length ? busy.reduce((sum, s) => sum + s.waiting, 0) / busy.length : 0,
    lockShare: busy.length ? busy.filter((s) => s.waiting > 0).length / busy.length : 0,
    maxActive: Math.max(...samples.map((s) => s.active)),
  };
}

const lines = ['# Kết quả benchmark bình luận (TF99)', '', `Tạo lúc ${new Date().toISOString()}`, ''];
const k6Files = readdirSync(OUT).filter((f) => /^(r1|w1)-.*\.json$/.test(f)).sort();

for (const file of k6Files) {
  const name = file.replace(/\.json$/, '');
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  let groupRequests = 0;
  lines.push(`## ${name}`, '', '| Nhóm | Số request | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Ngưỡng |', '|---|---:|---:|---:|---:|---:|---|');
  for (const [metric, value] of Object.entries(data.metrics)) {
    const match = /^http_req_duration\{(.+)\}$/.exec(metric);
    if (!match) continue;
    const group = match[1];
    const count = value.values.count;
    groupRequests += count ?? 0;
    const verdict = value.thresholds
      ? Object.entries(value.thresholds).map(([rule, r]) => `${r.ok ? 'ĐẠT' : 'TRƯỢT'} ${rule}`).join(', ')
      : '';
    const v = value.values;
    lines.push(`| ${group} | ${count ?? '–'} | ${ms(v.med)} | ${ms(v['p(95)'])} | ${ms(v['p(99)'])} | ${ms(v.max)} | ${verdict} |`);
  }
  const failed = Object.entries(data.metrics).filter(([m]) => m.startsWith('http_req_failed{name:'));
  for (const [metric, value] of failed) lines.push('', `Tỉ lệ lỗi ${metric}: ${(value.values.rate * 100).toFixed(2)}%`);

  const pagination = data.setup_data?.pagination;
  if (pagination) {
    lines.push('', `Phân trang: ${pagination.pages} trang, total ${pagination.total}, đi hết thấy ${pagination.seen}, thiếu ${pagination.missing}, lặp ${pagination.duplicates}.`);
  }

  const before = readTables(join(OUT, `tables-${name}-before.csv`));
  const after = readTables(join(OUT, `tables-${name}-after.csv`));
  // Chỉ tính request của các nhóm đo, bỏ lượt đăng nhập và đi trang trong setup.
  const requests = groupRequests;
  if (before && after && requests) {
    lines.push('', '| Bảng | Lượt quét mỗi request | Quét tuần tự | Dòng thêm |', '|---|---:|---:|---:|');
    for (const table of Object.keys(after)) {
      const scans = after[table].scans - (before[table]?.scans ?? 0);
      const seqScans = after[table].seqScans - (before[table]?.seqScans ?? 0);
      const inserted = after[table].inserted - (before[table]?.inserted ?? 0);
      lines.push(`| ${table} | ${(scans / requests).toFixed(2)} | ${seqScans} | ${inserted} |`);
    }
  }

  const locks = readLocks(join(OUT, `locks-${name}.csv`));
  if (locks) {
    lines.push(
      '',
      `Chờ khoá (${locks.samples} mẫu, 100 ms/mẫu): tối đa ${locks.maxWaiting} phiên cùng chờ, trung bình ${locks.avgWaitingWhenBusy.toFixed(1)} khi có tải, ${(locks.lockShare * 100).toFixed(0)}% mẫu có phiên chờ khoá, tối đa ${locks.maxActive} phiên chạy cùng lúc.`,
    );
  }
  lines.push('');
}

writeFileSync(join(OUT, 'summary.md'), `${lines.join('\n')}\n`);
process.stdout.write(lines.join('\n'));
