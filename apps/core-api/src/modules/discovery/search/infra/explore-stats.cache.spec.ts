import type { Redis } from 'ioredis';
import { buildIndex } from '../domain/explore/build.js';
import { MemoryExploreSource } from '../domain/explore/memory-source.js';
import { ExploreStatsCache } from './explore-stats.cache.js';

function fakeRedis() {
  const kv = new Map<string, string>();
  const get = vi.fn(async (k: string) => kv.get(k) ?? null);
  const set = vi.fn(async (k: string, v: string) => {
    kv.set(k, v);
    return 'OK';
  });
  return { kv, get, set, redis: { get, set } as unknown as Pick<Redis, 'get' | 'set'> };
}

describe('ExploreStatsCache', () => {
  const index = buildIndex([
    { id: 'hotel:1', kind: 'stay', title: 'Lotte Center Hà Nội', addr: '54 Liễu Giai', place: 'Hà Nội', lat: 21.03, lon: 105.81 },
    { id: 'hotel:2', kind: 'stay', title: 'Khách sạn Đồng Khởi', addr: '12 Đồng Khởi', place: 'Sài Gòn', lat: 10.77, lon: 106.7 },
    { id: 'poi:1', kind: 'food', title: 'Phở Trứng Hà Nội', addr: '10 Đồng Khởi', place: 'Hà Nội', lat: 21.02, lon: 105.85 },
  ]);

  it('save nén gzip lên Redis; instance khác đọc từ Redis và khớp 100% với MemoryExploreSource', async () => {
    const r = fakeRedis();
    const writer = new ExploreStatsCache(r.redis);
    await writer.save(index.counts);

    const reader = new ExploreStatsCache(r.redis);
    const mem = new MemoryExploreSource(index);

    expect(await reader.counts([{ ns: 'df', key: 'lotte' }, { ns: 'clat', key: 'Hà Nội' }])).toEqual(
      await mem.counts([{ ns: 'df', key: 'lotte' }, { ns: 'clat', key: 'Hà Nội' }]),
    );
    expect(await reader.typoPool('l', 3, 7)).toEqual(await mem.typoPool('l', 3, 7));
    expect(await reader.phrasePool('d', 5, 12)).toEqual(await mem.phrasePool('d', 5, 12));
  });

  it('cache hit trong cửa sổ 30s không gọi Redis; hết 30s cùng version chỉ kiểm version không đọc lại blob', async () => {
    let clock = 1_000;
    const r = fakeRedis();
    const writer = new ExploreStatsCache(r.redis, undefined, () => clock);
    await writer.save(index.counts);

    const reader = new ExploreStatsCache(r.redis, undefined, () => clock);
    await reader.counts([{ ns: 'df', key: 'pho' }]);
    expect(r.get).toHaveBeenCalledTimes(2); // ver + v1

    r.get.mockClear();
    clock += 10_000; // < 30s
    await reader.counts([{ ns: 'df', key: 'pho' }]);
    expect(r.get).not.toHaveBeenCalled();

    clock += 30_000; // >= 30s
    await reader.counts([{ ns: 'df', key: 'pho' }]);
    expect(r.get).toHaveBeenCalledTimes(1); // chỉ đọc ver
  });

  it('Redis trống lúc cold-start -> rơi về fallbackLoader một lần', async () => {
    const r = fakeRedis();
    const fallbackLoader = vi.fn(async () => index.counts);
    const cache = new ExploreStatsCache(r.redis, fallbackLoader);
    const got = await cache.counts([{ ns: 'df', key: 'pho' }]);
    expect(fallbackLoader).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ ns: 'df', key: 'pho', n: 1 }]);
  });
});
