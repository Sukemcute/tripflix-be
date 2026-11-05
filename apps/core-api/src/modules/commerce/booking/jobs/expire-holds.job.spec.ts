import type { CoreEnv } from '../../../../platform/env.js';
import type { ExpireHoldsUseCases } from '../application/expire-holds.use-cases.js';
import { ExpireHoldsJob } from './expire-holds.job.js';

describe('ExpireHoldsJob', () => {
  const start = (env: Partial<CoreEnv>, expireHolds = vi.fn().mockResolvedValue({ expired: 0, skipped: 0, errors: 0 })) => {
    const job = new ExpireHoldsJob({ expireHolds } as unknown as ExpireHoldsUseCases, env as CoreEnv);
    job.onApplicationBootstrap();
    return { job, expireHolds };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['worker', 'all'])('APP_ROLE=%s: chạy mỗi phút', async (role) => {
    const { job, expireHolds } = start({ NODE_ENV: 'production', APP_ROLE: role } as Partial<CoreEnv>);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(expireHolds).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_001);
    expect(expireHolds).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireHolds).toHaveBeenCalledTimes(3);
  });

  it('APP_ROLE=api hoặc NODE_ENV=test: không chạy', async () => {
    const api = start({ NODE_ENV: 'production', APP_ROLE: 'api' } as Partial<CoreEnv>);
    const test = start({ NODE_ENV: 'test', APP_ROLE: 'all' } as Partial<CoreEnv>);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.expireHolds).not.toHaveBeenCalled();
    expect(test.expireHolds).not.toHaveBeenCalled();
  });

  it('lần trước chưa xong thì không chạy chồng; lần lỗi không làm dừng job', async () => {
    let finish!: () => void;
    const expireHolds = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ expired: 0, skipped: 0, errors: 0 }))))
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue({ expired: 1, skipped: 0, errors: 0 });
    const { job } = start({ NODE_ENV: 'production', APP_ROLE: 'worker' } as Partial<CoreEnv>, expireHolds);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(expireHolds).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(expireHolds).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
  });
});
