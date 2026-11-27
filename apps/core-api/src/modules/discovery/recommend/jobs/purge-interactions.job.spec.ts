import type { CoreEnv } from '../../../../platform/env.js';
import type { RecommendStore } from '../application/ports.js';
import type { JobRuns } from '../../jobs/job-runs.js';
import { PurgeInteractionsJob } from './purge-interactions.job.js';

const passThroughRuns = { track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn() } as unknown as JobRuns;

describe('PurgeInteractionsJob', () => {
  const make = (batches: number[], locked = false, excessBatches: number[] = []) => {
    const purgeExpired = vi.fn(async () => batches.shift() ?? 0);
    const purgeExcess = vi.fn(async () => excessBatches.shift() ?? 0);
    const purgeQueryGrams = vi.fn(async () => 7);
    const store = { withLock: (_: string, fn: () => Promise<number>) => (locked ? Promise.resolve(null) : fn()), purgeExpired, purgeExcess };
    const job = new PurgeInteractionsJob({ APP_ROLE: 'worker' } as CoreEnv, store as unknown as RecommendStore, passThroughRuns, { purgeQueryGrams });
    return { job, purgeExpired, purgeExcess, purgeQueryGrams };
  };

  it('xoá theo lô 5.000 tới khi một lô không đầy', async () => {
    const { job, purgeExpired } = make([5_000, 5_000, 12]);
    expect(await job.run()).toBe(10_012 + 7);
    expect(purgeExpired).toHaveBeenCalledTimes(3);
    expect(purgeExpired).toHaveBeenCalledWith(expect.any(Date), 5_000);
  });

  it('xoá dòng chỉ-thêm vượt trần theo lô tới khi một lô không đầy, cộng vào tổng', async () => {
    const { job, purgeExcess } = make([3], false, [5_000, 40]);
    expect(await job.run()).toBe(3 + 5_040 + 7);
    expect(purgeExcess).toHaveBeenCalledTimes(2);
    expect(purgeExcess).toHaveBeenCalledWith(5_000);
  });

  it('dừng khẩn cấp giữa các lô: không xoá lô kế tiếp, không xoá đếm câu tìm', async () => {
    const controller = new AbortController();
    const purgeExpired = vi.fn(async () => {
      controller.abort(new Error('Dừng khẩn cấp: thử'));
      return 5_000;
    });
    const purgeExcess = vi.fn(async () => 0);
    const purgeQueryGrams = vi.fn(async () => 7);
    const store = { withLock: (_: string, fn: () => Promise<number>) => fn(), purgeExpired, purgeExcess };
    const runs = { track: (_job: string, _trigger: string, fn: (signal: AbortSignal) => Promise<unknown>) => fn(controller.signal) } as unknown as JobRuns;
    const job = new PurgeInteractionsJob({ APP_ROLE: 'worker' } as CoreEnv, store as unknown as RecommendStore, runs, { purgeQueryGrams });
    expect(await job.run()).toBeNull();
    expect(purgeExpired).toHaveBeenCalledTimes(1);
    expect(purgeExcess).not.toHaveBeenCalled();
    expect(purgeQueryGrams).not.toHaveBeenCalled();
    expect(job.isRunning).toBe(false);
  });

  it('xoá đếm câu tìm trước 90 ngày', async () => {
    const { job, purgeQueryGrams } = make([0]);
    await job.run('schedule', new Date('2026-11-16T03:00:00Z'));
    expect(purgeQueryGrams).toHaveBeenCalledWith('2026-08-18');
  });

  it('worker khác giữ khoá: bỏ lượt', async () => {
    const { job, purgeExpired, purgeQueryGrams } = make([], true);
    expect(await job.run()).toBeNull();
    expect(purgeExpired).not.toHaveBeenCalled();
    expect(purgeQueryGrams).not.toHaveBeenCalled();
  });

  it('APP_ROLE=api: không hẹn giờ', () => {
    const job = new PurgeInteractionsJob({ APP_ROLE: 'api' } as CoreEnv, {} as RecommendStore, passThroughRuns, { purgeQueryGrams: vi.fn() });
    job.onApplicationBootstrap();
    expect((job as unknown as { timer?: unknown }).timer).toBeUndefined();
  });
});
