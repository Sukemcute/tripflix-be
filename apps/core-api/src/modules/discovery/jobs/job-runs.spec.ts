import type { Redis } from 'ioredis';
import { JobRuns } from './job-runs.js';

/** Redis giả: đủ hset/hvals/hdel/expire và multi().hset().expire().exec(). */
function fakeRedis(opts: { isBroken?: boolean } = {}) {
  const hashes = new Map<string, Map<string, string>>();
  const hash = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  const fail = () => Promise.reject(new Error('redis down'));
  const redis = {
    hvals: (k: string) => (opts.isBroken ? fail() : Promise.resolve([...hash(k).values()])),
    hdel: (k: string, ...fields: string[]) => Promise.resolve(fields.filter((f) => hash(k).delete(f)).length),
    multi: () => {
      const ops: Array<() => void> = [];
      const tx = {
        hset: (k: string, f: string, v: string) => (ops.push(() => hash(k).set(f, v)), tx),
        expire: () => tx,
        exec: () => (opts.isBroken ? fail() : Promise.resolve(ops.map((op) => (op(), [null, 1])))),
      };
      return tx;
    },
  };
  return { redis: redis as unknown as Redis, hashes };
}

describe('JobRuns', () => {
  it('ghi running khi đang chạy rồi ghi kết quả, kèm tóm tắt và thời lượng', async () => {
    const { redis } = fakeRedis();
    const runs = new JobRuns(redis);
    let seenWhileRunning: string[] = [];
    await runs.track('recommend_build', 'manual', async () => {
      seenWhileRunning = (await runs.list('recommend_build')).map((r) => r.outcome);
      return { outcome: 'succeeded', summary: { posts: 3, users: 1, failedBuilders: [] } };
    });
    expect(seenWhileRunning).toEqual(['running']);
    const [run] = await runs.list('recommend_build');
    expect(run).toMatchObject({ trigger: 'manual', outcome: 'succeeded', summary: { posts: 3, users: 1 }, error: null });
    expect(run!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('thân job ném lỗi: ghi failed kèm lỗi rồi ném lại', async () => {
    const runs = new JobRuns(fakeRedis().redis);
    await expect(runs.track('explore', 'schedule', () => Promise.reject(new Error('index hỏng')))).rejects.toThrow('index hỏng');
    expect(await runs.list('explore')).toMatchObject([{ outcome: 'failed', error: 'index hỏng' }]);
  });

  it('giữ 20 lần gần nhất, mới nhất trước', async () => {
    const { redis, hashes } = fakeRedis();
    const runs = new JobRuns(redis);
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 25; i++) {
        vi.setSystemTime(1_000 + i);
        await runs.track('suggest', 'schedule', () => Promise.resolve({ outcome: 'succeeded', summary: { count: i } }));
      }
    } finally {
      vi.useRealTimers();
    }
    const list = await runs.list('suggest');
    expect(hashes.get('discovery:job-runs:suggest')!.size).toBe(20);
    expect(list[0]!.summary?.count).toBe(24);
  });

  it('Redis lỗi: job vẫn chạy và trả kết quả', async () => {
    const runs = new JobRuns(fakeRedis({ isBroken: true }).redis);
    await expect(runs.track('recommend_purge', 'manual', () => Promise.resolve({ outcome: 'succeeded', summary: { deleted: 0 } }))).resolves.toMatchObject({ outcome: 'succeeded' });
  });
});
