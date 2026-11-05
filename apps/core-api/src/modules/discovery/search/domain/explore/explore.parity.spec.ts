// So bản TS với prototype Python trên dữ liệu thử nghiệm của prototype (không có trong repo).
// Chạy: EXPLORE_PARITY_DIR=<thư mục experiments/natural-search> pnpm vitest run explore.parity
// Cần data/index/objects.json, search/bench.tsv và data/index/bench-last.json (kết quả Python, sinh bằng scripts/bench.py).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex } from './build.js';
import { MemoryExploreSource } from './memory-source.js';
import { searchExplore } from './rank.js';
import type { ExploreObject } from './types.js';

const dir = process.env.EXPLORE_PARITY_DIR;

describe.skipIf(!dir)('so với bản Python', () => {
  it('cùng kết quả cho mọi câu trong bench.tsv', async () => {
    const raw = JSON.parse(readFileSync(join(dir!, 'data/index/objects.json'), 'utf8')) as Array<Record<string, unknown>>;
    const objects = raw.map((r) => ({
      ...r,
      lat: r.lat == null ? null : Number(r.lat),
      lon: r.lon == null ? null : Number(r.lon),
      priceNight: r.price_night ?? null,
      priceSim: Boolean(r.price_sim),
    })) as unknown as ExploreObject[];
    const source = new MemoryExploreSource(buildIndex(objects));
    const expected = JSON.parse(readFileSync(join(dir!, 'data/index/bench-last.json'), 'utf8')) as Record<string, unknown[]>;
    const diffs: string[] = [];
    for (const line of readFileSync(join(dir!, 'search/bench.tsv'), 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [q, locText] = line.split('\t') as [string, string | undefined];
      const [lat, lon] = (locText ?? '').split(',').map(Number);
      const loc = locText ? { lat: lat!, lon: lon! } : null;
      const r = await searchExplore(source, q, { loc });
      const got = [
        ...r.sections.map((s) => [s.kind, s.total, s.items.map((i) => i.obj.id)]),
        ['suggest', r.suggest.length, r.suggest.map((i) => i.obj.id)],
      ];
      const key = q + (loc ? ` @${loc.lat},${loc.lon}` : '');
      if (JSON.stringify(got) !== JSON.stringify(expected[key])) diffs.push(`${key}\n  py: ${JSON.stringify(expected[key])}\n  ts: ${JSON.stringify(got)}`);
    }
    expect(diffs).toEqual([]);
  }, 600_000);
});
