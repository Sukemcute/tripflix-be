import type { CoreEnv } from '../../../../platform/env.js';
import type { JobRuns } from '../../jobs/job-runs.js';
import type { BuildFeaturesUseCases } from '../application/build-features.use-cases.js';
import type { BuildProductFeaturesUseCases } from '../application/build-product-features.use-cases.js';
import { BuildFeaturesJob } from './build-features.job.js';

const minute = 60_000;

function setup() {
  let intervalMs = 10 * minute;
  const runCycle = vi.fn(async () => ({ posts: 1, users: 1, failedBuilders: [] }));
  const runs = {
    track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn(),
    getIntervalMs: vi.fn(async () => intervalMs),
  };
  const productCycle = vi.fn(async () => ({ hotels: 2, flights: 3, failedBuilders: [] }));
  const job = new BuildFeaturesJob(
    { APP_ROLE: 'worker' } as CoreEnv,
    { runCycle } as unknown as BuildFeaturesUseCases,
    runs as unknown as JobRuns,
    { runCycle: productCycle } as unknown as BuildProductFeaturesUseCases,
  );
  return { job, runCycle, productCycle, runs, changeInterval: (ms: number) => (intervalMs = ms) };
}

describe('BuildFeaturesJob: chu kỳ admin đổi được (TF103)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mặc định 10 phút; đổi chu kỳ có hiệu lực trong vòng 1 phút, không cần khởi động lại', async () => {
    const { job, runCycle, runs, changeInterval } = setup();
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(runCycle).toHaveBeenCalledTimes(1); // phút 0
    expect(runs.getIntervalMs).toHaveBeenCalledWith('recommend_build', 10 * minute);

    await vi.advanceTimersByTimeAsync(10 * minute - 1);
    expect(runCycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runCycle).toHaveBeenCalledTimes(2); // phút 10

    changeInterval(30 * minute); // admin nới ra 30 phút
    await vi.advanceTimersByTimeAsync(29 * minute);
    expect(runCycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(minute);
    expect(runCycle).toHaveBeenCalledTimes(3); // phút 40
    job.onApplicationShutdown();
  });

  it('TF39: mỗi lượt dựng cả hồ sơ khách sạn và chuyến bay', async () => {
    const { job, productCycle } = setup();
    await job.run('manual');
    expect(productCycle).toHaveBeenCalledTimes(1);
  });

  it('chạy tay tính là một lượt: lượt tự động kế tiếp đếm từ đó', async () => {
    const { job, runCycle } = setup();
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5 * minute);
    await job.run('manual'); // phút 5
    await vi.advanceTimersByTimeAsync(9 * minute);
    expect(runCycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(minute);
    expect(runCycle).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
  });
});
