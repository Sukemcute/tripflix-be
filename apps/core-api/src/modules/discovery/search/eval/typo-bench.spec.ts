// Bench đầy đủ (không chạy trong CI). In bảng điểm để ghi vào evidence.
// SEARCH_BENCH=1 pnpm vitest run typo-bench            -> cold (220 khách sạn) + seed đủ
// thêm EXPLORE_PARITY_DIR=<experiments/natural-search>  -> thêm warm (12,5k mục của prototype)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExploreObject } from '../domain/explore/types.js';
import { buildCases, dayPairBench, outOfScopeRate, runBench, seedHotels, seedPosts, sourceOf } from './typo-bench.js';

const isOn = Boolean(process.env.SEARCH_BENCH);
const protoDir = process.env.EXPLORE_PARITY_DIR;

const tf13 = JSON.parse(readFileSync(join(import.meta.dirname, 'queries.json'), 'utf8')) as {
  queries: Array<{ q: string; group: string }>;
};
const outOfScope = tf13.queries.filter((x) => x.group === 'out_of_scope').map((x) => x.q);

async function report(name: string, objs: ExploreObject[]) {
  const source = sourceOf(objs);
  const rows = await runBench(source, buildCases(objs));
  const oos = await outOfScopeRate(source, outOfScope);
  const days = await dayPairBench(source, objs);
  const lines = rows.map((r) => `| ${r.group} | ${r.n} | ${r.recallMain} | ${r.recallAny} | ${r.fixedRate} |`);
  process.stdout.write(
    [`\n### ${name} (${objs.length} mục)`, '| nhóm | n | recall chính % | recall cả thay thế % | có sửa % |', '|---|---|---|---|---|', ...lines, `ngoài phạm vi có kết quả chính: ${oos}%`, `cặp số ngày (${days.pairs} cặp): trùng top-6 ${days.overlap}% · mục đầu đúng số ngày ${days.top1Days}%`, ''].join('\n'),
  );
}

describe.skipIf(!isOn)('bench lỗi gõ', () => {
  it('cold: 220 khách sạn + bài seed', () => report('cold', [...seedHotels(220), ...seedPosts()]), 600_000);
  it('seed đủ', () => report('seed', [...seedHotels(), ...seedPosts()]), 600_000);
  it.skipIf(!protoDir)('warm: prototype', async () => {
    const raw = JSON.parse(readFileSync(join(protoDir!, 'data/index/objects.json'), 'utf8')) as Array<Record<string, unknown>>;
    const objs = raw.map((r) => ({ ...r, lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon), priceNight: r.price_night ?? null })) as unknown as ExploreObject[];
    await report('warm', objs);
  }, 1_200_000);
});
