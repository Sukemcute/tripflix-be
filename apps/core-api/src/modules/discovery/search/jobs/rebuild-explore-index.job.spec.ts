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

describe('RebuildExploreIndexJob với Typesense: đối soát 24 giờ, khởi động không dựng lại', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setupTypesense(opts: { hasIndex: boolean; lastSucceededAgoMs: number | null }) {
    const rebuildIndex = vi.fn(async () => 1);
    const now = Date.now();
    const runs = {
      track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn(),
      // Admin chưa đặt chu kỳ: trả mặc định job đưa vào.
      getIntervalMs: vi.fn(async (_job: string, fallback: number) => fallback),
      list: vi.fn(async () =>
        opts.lastSucceededAgoMs === null ? [] : [{ outcome: 'failed', startedAt: now - 1_000 }, { outcome: 'succeeded', startedAt: now - opts.lastSucceededAgoMs }],
      ),
    };
    const job = new RebuildExploreIndexJob(
      { APP_ROLE: 'all', SEARCH_BACKEND: 'typesense' } as CoreEnv,
      { rebuildIndex, hasIndex: vi.fn(async () => opts.hasIndex) } as unknown as ExploreUseCases,
      { start: vi.fn(), finish: vi.fn() } as unknown as IndexHealth,
      runs as unknown as JobRuns,
    );
    return { job, rebuildIndex };
  }

  it('chu kỳ mặc định: 24 giờ với Typesense, 10 phút với Postgres', () => {
    expect(setupTypesense({ hasIndex: true, lastSucceededAgoMs: null }).job.defaultIntervalMs).toBe(24 * 60 * minute);
    expect(setup().job.defaultIntervalMs).toBe(10 * minute);
  });

  it('chỉ mục còn và lượt thành công gần nhất mới 1 giờ trước: không dựng khi khởi động, đến hạn mới dựng', async () => {
    const { job, rebuildIndex } = setupTypesense({ hasIndex: true, lastSucceededAgoMs: 60 * minute });
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(minute);
    expect(rebuildIndex).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23 * 60 * minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    job.onApplicationShutdown();
  });

  it('mất chỉ mục (volume mới) thì dựng ngay dù lượt trước còn mới', async () => {
    const { job, rebuildIndex } = setupTypesense({ hasIndex: false, lastSucceededAgoMs: 60 * minute });
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    job.onApplicationShutdown();
  });
});

describe('RebuildExploreIndexJob với Typesense: chặn chu kỳ quá dày', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('admin đặt 1 phút thì vẫn chỉ dựng tối đa 1 lần/giờ (mỗi lượt ghi lại cả chỉ mục)', async () => {
    const rebuildIndex = vi.fn(async () => 1);
    const runs = {
      track: (_job: string, _trigger: string, fn: () => Promise<unknown>) => fn(),
      getIntervalMs: vi.fn(async () => minute),
      list: vi.fn(async () => []),
    };
    const job = new RebuildExploreIndexJob(
      { APP_ROLE: 'all', SEARCH_BACKEND: 'typesense' } as CoreEnv,
      { rebuildIndex, hasIndex: vi.fn(async () => false) } as unknown as ExploreUseCases,
      { start: vi.fn(), finish: vi.fn() } as unknown as IndexHealth,
      runs as unknown as JobRuns,
    );
    job.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59 * minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(minute);
    expect(rebuildIndex).toHaveBeenCalledTimes(2);
    job.onApplicationShutdown();
  });
});
