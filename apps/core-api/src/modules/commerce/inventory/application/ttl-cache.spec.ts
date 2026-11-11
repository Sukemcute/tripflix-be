import { TtlCache } from './ttl-cache.js';

describe('TtlCache', () => {
  it('trong hạn sống thì trả lại kết quả cũ, không gọi lại nguồn', async () => {
    let now = 0;
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, now: () => now });
    let calls = 0;
    const load = async () => ++calls;
    expect(await cache.get('a', load)).toBe(1);
    now = 999;
    expect(await cache.get('a', load)).toBe(1);
    now = 1_000;
    expect(await cache.get('a', load)).toBe(2);
    expect(calls).toBe(2);
  });

  it('nhiều request cùng lúc cùng khoá chỉ gọi nguồn một lần', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, maxEntries: 10, now: () => 0 });
    let calls = 0;
    let resolve!: (value: string) => void;
    const load = () => {
      calls += 1;
      return new Promise<string>((r) => (resolve = r));
    };
    const first = cache.get('k', load);
    const second = cache.get('k', load);
    resolve('ok');
    expect(await Promise.all([first, second])).toEqual(['ok', 'ok']);
    expect(calls).toBe(1);
  });

  it('lỗi không được giữ: lần sau gọi lại nguồn', async () => {
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, now: () => 0 });
    await expect(cache.get('k', () => Promise.reject(new Error('db')))).rejects.toThrow('db');
    expect(cache.size).toBe(0);
    expect(await cache.get('k', async () => 7)).toBe(7);
  });

  it('vượt số mục tối đa thì bỏ mục cũ nhất', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1_000, maxEntries: 2, now: () => 0 });
    await cache.get('a', async () => 'a1');
    await cache.get('b', async () => 'b1');
    await cache.get('c', async () => 'c1');
    expect(cache.size).toBe(2);
    expect(await cache.get('a', async () => 'a2')).toBe('a2');
    expect(await cache.get('c', async () => 'c2')).toBe('c1');
  });
});
