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

  it('nguồn lỗi được chấp nhận thì trả kết quả tốt gần nhất', async () => {
    let now = 0;
    const error = new Error('db');
    const canServeStale = vi.fn((cause: unknown) => cause === error);
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, staleMs: 5_000, canServeStale, now: () => now });
    await cache.get('k', async () => 7);
    now = 1_000;
    await expect(cache.get('k', () => Promise.reject(error))).resolves.toBe(7);
    expect(canServeStale).toHaveBeenCalledWith(error);
  });

  it('nguồn lỗi không được chấp nhận thì báo lỗi', async () => {
    let now = 0;
    const error = new Error('boom');
    const canServeStale = vi.fn((_cause: unknown) => false);
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, staleMs: 5_000, canServeStale, now: () => now });
    await cache.get('k', async () => 7);
    now = 1_000;
    await expect(cache.get('k', () => Promise.reject(error))).rejects.toBe(error);
    expect(canServeStale).toHaveBeenCalledWith(error);
  });

  it('kết quả cũ quá staleMs thì báo lỗi', async () => {
    let now = 0;
    const error = new Error('db');
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, staleMs: 5_000, canServeStale: () => true, now: () => now });
    await cache.get('k', async () => 7);
    now = 5_001;
    await expect(cache.get('k', () => Promise.reject(error))).rejects.toBe(error);
  });

  it('không có staleMs thì luôn báo lỗi nguồn', async () => {
    let now = 0;
    const error = new Error('db');
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, canServeStale: () => true, now: () => now });
    await cache.get('k', async () => 7);
    now = 1_000;
    await expect(cache.get('k', () => Promise.reject(error))).rejects.toBe(error);
    await expect(cache.get('k', () => Promise.reject(error))).rejects.toBe(error);
  });

  it('nguồn hồi phục thì thay kết quả cũ bằng giá trị mới', async () => {
    let now = 0;
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 10, staleMs: 5_000, canServeStale: () => true, now: () => now });
    await cache.get('k', async () => 7);
    now = 1_000;
    expect(await cache.get('k', () => Promise.reject(new Error('db')))).toBe(7);
    now = 2_000;
    expect(await cache.get('k', async () => 9)).toBe(9);
    now = 3_000;
    expect(await cache.get('k', () => Promise.reject(new Error('db')))).toBe(9);
  });
});
