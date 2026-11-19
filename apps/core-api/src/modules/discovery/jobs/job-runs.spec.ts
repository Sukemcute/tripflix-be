import type { Redis } from 'ioredis';
import { isDue, JobRuns } from './job-runs.js';

/** Redis giả: đủ hset/hvals/hdel/expire và multi().hset().expire().exec(). */
function fakeRedis(opts: { isBroken?: boolean } = {}) {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  const hash = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  const fail = () => Promise.reject(new Error('redis down'));
  const redis = {
    get: (k: string) => (opts.isBroken ? fail() : Promise.resolve(strings.get(k) ?? null)),
    set: (k: string, v: string) => (strings.set(k, v), Promise.resolve('OK')),
    del: (k: string) => Promise.resolve(Number(strings.delete(k))),
    exists: (k: string) => Promise.resolve(Number(strings.has(k))),
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
  return { redis: redis as unknown as Redis, hashes, strings };
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

  it('lượt running của tiến trình đã chết (hết khoá sống) thành failed; lượt còn sống giữ nguyên', async () => {
    const { redis, hashes, strings } = fakeRedis();
    const runs = new JobRuns(redis);
    const running = { trigger: 'schedule', finishedAt: null, outcome: 'running', durationMs: null, summary: null, error: null };
    const hash = new Map([
      ['dead', JSON.stringify({ ...running, runId: 'dead', startedAt: 1_000 })],
      ['live', JSON.stringify({ ...running, runId: 'live', startedAt: 2_000 })],
    ]);
    hashes.set('discovery:job-runs:recommend_build', hash);
    strings.set('discovery:job-run-alive:live', '1');

    const list = await runs.list('recommend_build');

    expect(list).toMatchObject([
      { runId: 'live', outcome: 'running', finishedAt: null },
      { runId: 'dead', outcome: 'failed', error: 'Bị ngắt: tiến trình dừng giữa chừng (deploy/restart)' },
    ]);
    expect(list[1]!.finishedAt).toBeGreaterThan(1_000);
    expect(JSON.parse(hash.get('dead')!)).toMatchObject({ outcome: 'failed' });
  });

  it('Redis lỗi: job vẫn chạy và trả kết quả', async () => {
    const runs = new JobRuns(fakeRedis({ isBroken: true }).redis);
    await expect(runs.track('recommend_purge', 'manual', () => Promise.resolve({ outcome: 'succeeded', summary: { deleted: 0 } }))).resolves.toMatchObject({ outcome: 'succeeded' });
  });

  it('chu kỳ: đặt, đọc, về mặc định; giá trị hỏng hay Redis lỗi thì dùng mặc định', async () => {
    const { redis, strings } = fakeRedis();
    const runs = new JobRuns(redis);
    expect(await runs.getIntervalMs('explore', 600_000)).toBe(600_000);
    await runs.setIntervalMs('explore', 1_800_000);
    expect(await runs.getIntervalMs('explore', 600_000)).toBe(1_800_000);
    strings.set('discovery:job-interval:explore', 'abc');
    expect(await runs.getIntervalMs('explore', 600_000)).toBe(600_000);
    await runs.setIntervalMs('explore', null);
    expect(strings.has('discovery:job-interval:explore')).toBe(false);
    expect(await new JobRuns(fakeRedis({ isBroken: true }).redis).getIntervalMs('explore', 600_000)).toBe(600_000);
  });
});

describe('isDue (TF103)', () => {
  const minute = 60_000;
  it('lượt trước ghi giờ trễ vài ms sau nhịp: nhịp đủ chu kỳ vẫn chạy, không trượt thêm một nhịp', () => {
    expect(isDue(5, 2 * minute, 2 * minute)).toBe(true);
    expect(isDue(5, 10 * minute, 10 * minute)).toBe(true);
  });
  it('chưa tới chu kỳ (nhịp trước đó) thì chưa chạy', () => {
    expect(isDue(5, 2 * minute, minute)).toBe(false);
    expect(isDue(5, 10 * minute, 9 * minute)).toBe(false);
  });
});
