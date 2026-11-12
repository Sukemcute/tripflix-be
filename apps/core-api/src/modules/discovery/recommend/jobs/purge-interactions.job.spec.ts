import type { CoreEnv } from '../../../../platform/env.js';
import type { RecommendStore } from '../application/ports.js';
import { PurgeInteractionsJob } from './purge-interactions.job.js';

describe('PurgeInteractionsJob', () => {
  const make = (batches: number[], locked = false) => {
    const purgeExpired = vi.fn(async () => batches.shift() ?? 0);
    const store = { withLock: (_: string, fn: () => Promise<number>) => (locked ? Promise.resolve(null) : fn()), purgeExpired };
    return { job: new PurgeInteractionsJob({ APP_ROLE: 'worker' } as CoreEnv, store as unknown as RecommendStore), purgeExpired };
  };

  it('xoá theo lô 5.000 tới khi một lô không đầy', async () => {
    const { job, purgeExpired } = make([5_000, 5_000, 12]);
    expect(await job.run()).toBe(10_012);
    expect(purgeExpired).toHaveBeenCalledTimes(3);
    expect(purgeExpired).toHaveBeenCalledWith(expect.any(Date), 5_000);
  });

  it('worker khác giữ khoá: bỏ lượt', async () => {
    const { job, purgeExpired } = make([], true);
    expect(await job.run()).toBeNull();
    expect(purgeExpired).not.toHaveBeenCalled();
  });

  it('APP_ROLE=api: không hẹn giờ', () => {
    const job = new PurgeInteractionsJob({ APP_ROLE: 'api' } as CoreEnv, {} as RecommendStore);
    job.onApplicationBootstrap();
    expect((job as unknown as { timer?: unknown }).timer).toBeUndefined();
  });
});
