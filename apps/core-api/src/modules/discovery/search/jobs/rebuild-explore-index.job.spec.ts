import type { CoreEnv } from '../../../../platform/env.js';
import type { JobRuns } from '../../jobs/job-runs.js';
import type { ExploreUseCases } from '../application/explore.use-cases.js';
import type { IndexHealth } from './index-health.js';
import { RebuildExploreIndexJob } from './rebuild-explore-index.job.js';

const minute = 60_000;

function setup() {
  let intervalMs = 10 * minute;
  const rebuildIndex = vi.fn(async () => 1);
  const health = { start: vi.fn(), finish: vi.fn() };
  const runs = {
    track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn(),
    getIntervalMs: vi.fn(async () => intervalMs),
  };
  const job = new RebuildExploreIndexJob(
    { APP_ROLE: 'worker' } as CoreEnv,
    { rebuildIndex } as unknown as ExploreUseCases,
    health as unknown as IndexHealth,
    runs as unknown as JobRuns,
  );
  return { job, rebuildIndex, health, changeInterval: (ms: number) => (intervalMs = ms) };
}

describe('RebuildExploreIndexJob: chu kỳ admin đổi được (TF103)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('đổi chu kỳ có hiệu lực trong vòng 1 phút, không cần khởi động lại; ghi chu kỳ vào health', async () => {
    const { job, rebuildIndex, health, changeInterval } = setup();
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuildIndex).toHaveBeenCalledTimes(1); // phút 0

    changeInterval(3 * minute); // admin rút còn 3 phút
    await vi.advanceTimersByTimeAsync(3 * minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(2);
    expect(health.start).toHaveBeenLastCalledWith('explore', expect.any(Number), 3 * minute);

    changeInterval(60 * minute); // admin nới ra 1 giờ
    await vi.advanceTimersByTimeAsync(59 * minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
  });

  it('chạy tay tính là một lượt: lượt tự động kế tiếp đếm từ đó', async () => {
    const { job, rebuildIndex } = setup();
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5 * minute);
    await job.run('manual'); // phút 5
    await vi.advanceTimersByTimeAsync(9 * minute); // phút 14: chưa đủ 10 phút từ lượt tay
    expect(rebuildIndex).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(3);
    job.onApplicationShutdown();
  });
});
