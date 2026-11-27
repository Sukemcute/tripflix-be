import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RecommendStore } from '../recommend/application/ports.js';
import type { CandidateLimitInfo, PostRecommendationUseCases } from '../recommend/application/post-recommendations.use-cases.js';
import type { BuildFeaturesJob } from '../recommend/jobs/build-features.job.js';
import type { PurgeInteractionsJob } from '../recommend/jobs/purge-interactions.job.js';
import type { RebuildExploreIndexJob } from '../search/jobs/rebuild-explore-index.job.js';
import type { RebuildSuggestIndexJob } from '../search/jobs/rebuild-suggest-index.job.js';
import { AdminDiscoveryJobsController } from './admin-discovery-jobs.controller.js';
import type { JobRuns } from './job-runs.js';

function setup() {
  const job = () => ({ isRunning: false, run: vi.fn(() => Promise.resolve()) });
  const explore = { ...job(), defaultIntervalMs: 600_000 }; // Postgres: 10 phút
  const suggest = job();
  const build = job();
  const purge = job();
  const runs = {
    list: vi.fn(async (name: string) => [{ runId: `r-${name}`, outcome: 'succeeded' }]),
    getIntervalMs: vi.fn(async (_job: string, fallback: number) => fallback),
    setIntervalMs: vi.fn(async () => undefined),
  };
  const store = {
    getAdminStats: vi.fn(async () => ({
      interactionsLast10m: 1,
      interactionsLast24h: 5,
      posts: 243,
      usersWithFeatures: 2,
      jobStates: [{ name: 'hot@v0', lastRunAt: new Date('2026-11-12T12:00:00Z'), lastError: null }],
    })),
    listActiveAlgos: vi.fn(async () => [{ name: 'for_you', postBuilder: 'hot@v0', userBuilder: 'tag_affinity@v0', ranker: 'tag_affinity_v0' }]),
  };
  const candidateInfo: CandidateLimitInfo = { algo: 'for_you', ranker: 'trip_v1', limit: 1000, defaultLimit: 1000, isOverridden: false, min: 200, max: 5000, rankTiming: { samples: 0, p50Ms: null, p95Ms: null } };
  const recommendations = {
    describeCandidateLimit: vi.fn(async (): Promise<CandidateLimitInfo> => ({ ...candidateInfo })),
    setCandidateLimit: vi.fn(async () => undefined),
  };
  const controller = new AdminDiscoveryJobsController(
    runs as unknown as JobRuns,
    store as unknown as RecommendStore,
    explore as unknown as RebuildExploreIndexJob,
    suggest as unknown as RebuildSuggestIndexJob,
    build as unknown as BuildFeaturesJob,
    purge as unknown as PurgeInteractionsJob,
    recommendations as unknown as PostRecommendationUseCases,
  );
  return { controller, explore, build, store, runs, recommendations };
}

describe('AdminDiscoveryJobsController', () => {
  it('group=search: chỉ job tìm kiếm, không có số liệu gợi ý', async () => {
    const { controller, explore, store } = setup();
    explore.isRunning = true;
    const page = await controller.list('search');
    expect(page.jobs.map((j) => [j.job, j.isRunning, j.runs[0]?.runId])).toEqual([
      ['explore', true, 'r-explore'],
      ['suggest', false, 'r-suggest'],
    ]);
    expect(page.jobs[1]!.intervalMs).toBeNull();
    expect(page.recommendStats).toBeNull();
    expect(store.getAdminStats).not.toHaveBeenCalled();
  });

  it('group=recommend: job gợi ý kèm số liệu và thuật toán đang bật', async () => {
    const page = await setup().controller.list('recommend');
    expect(page.jobs.map((j) => j.job)).toEqual(['recommend_build', 'recommend_purge']);
    expect(page.recommendStats).toMatchObject({
      posts: 243,
      algos: [{ name: 'for_you' }],
      jobStates: [{ name: 'hot@v0', lastRunAt: '2026-11-12T12:00:00.000Z' }],
      candidateLimit: { ranker: 'trip_v1', limit: 1000, defaultLimit: 1000, min: 200, max: 5000 },
    });
  });

  it('group sai → 400', async () => {
    await expect(setup().controller.list('ai')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quyền: xem cho moderator và superadmin, chạy ngay và đổi chu kỳ chỉ superadmin', () => {
    const roles = (method: 'list' | 'run' | 'setInterval' | 'setCandidateLimit') => Reflect.getMetadata('tripflix:roles', AdminDiscoveryJobsController.prototype[method]) as string[];
    expect(roles('list')).toEqual(['moderator', 'superadmin']);
    expect(roles('run')).toEqual(['superadmin']);
    expect(roles('setInterval')).toEqual(['superadmin']);
    expect(roles('setCandidateLimit')).toEqual(['superadmin']);
  });

  it('chạy ngay: gọi run("manual") không chờ; đang chạy thì từ chối; job lạ → 404', () => {
    const { controller, build } = setup();
    expect(controller.run('recommend_build')).toEqual({ accepted: true, reason: null });
    expect(build.run).toHaveBeenCalledWith('manual');
    build.isRunning = true;
    expect(controller.run('recommend_build')).toEqual({ accepted: false, reason: 'running' });
    expect(build.run).toHaveBeenCalledTimes(1);
    expect(() => controller.run('drop_db')).toThrow(NotFoundException);
  });

  describe('TF103: chu kỳ job', () => {
    it('GET trả chu kỳ đang dùng (Redis), mặc định và job nào đổi được', async () => {
      const { controller, runs } = setup();
      runs.getIntervalMs.mockResolvedValueOnce(1_800_000);
      const [explore, suggest] = (await controller.list('search')).jobs;
      expect(explore).toMatchObject({ intervalMs: 1_800_000, defaultIntervalMs: 600_000, canChangeInterval: true });
      expect(suggest).toMatchObject({ intervalMs: null, defaultIntervalMs: null, canChangeInterval: false });
      expect(runs.getIntervalMs).toHaveBeenCalledTimes(1);
    });

    it('PUT đổi chu kỳ recommend_build; GET nhóm recommend hiện chu kỳ đang dùng', async () => {
      const { controller, runs } = setup();
      expect(await controller.setInterval('recommend_build', { intervalMs: 3_600_000 })).toEqual({ job: 'recommend_build', intervalMs: 3_600_000, defaultIntervalMs: 600_000 });
      expect(runs.setIntervalMs).toHaveBeenLastCalledWith('recommend_build', 3_600_000);
      runs.getIntervalMs.mockResolvedValueOnce(3_600_000);
      const [build, purge] = (await controller.list('recommend')).jobs;
      expect(build).toMatchObject({ intervalMs: 3_600_000, defaultIntervalMs: 600_000, canChangeInterval: true });
      expect(purge).toMatchObject({ intervalMs: 86_400_000, canChangeInterval: false });
    });

    it('PUT đổi chu kỳ explore; null về mặc định', async () => {
      const { controller, runs } = setup();
      expect(await controller.setInterval('explore', { intervalMs: 1_800_000 })).toEqual({ job: 'explore', intervalMs: 1_800_000, defaultIntervalMs: 600_000 });
      expect(runs.setIntervalMs).toHaveBeenLastCalledWith('explore', 1_800_000);
      expect(await controller.setInterval('explore', { intervalMs: null })).toMatchObject({ intervalMs: 600_000 });
      expect(runs.setIntervalMs).toHaveBeenLastCalledWith('explore', null);
    });

    it.each([{ intervalMs: 59_999 }, { intervalMs: 86_400_001 }, { intervalMs: 1.5 }, { intervalMs: '600000' }, {}])('PUT body sai %o -> 400', async (body) => {
      const { controller, runs } = setup();
      await expect(controller.setInterval('explore', body)).rejects.toBeInstanceOf(BadRequestException);
      expect(runs.setIntervalMs).not.toHaveBeenCalled();
    });

    it('PUT job không đổi được chu kỳ -> 400, job lạ -> 404', async () => {
      const { controller } = setup();
      await expect(controller.setInterval('suggest', { intervalMs: 600_000 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.setInterval('recommend_purge', { intervalMs: 600_000 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.setInterval('drop_db', { intervalMs: 600_000 })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('số ứng viên gợi ý for_you', () => {
    it('PUT đặt số ứng viên rồi trả trạng thái mới; null về mặc định', async () => {
      const { controller, recommendations } = setup();
      recommendations.describeCandidateLimit.mockResolvedValueOnce({ algo: 'for_you', ranker: 'trip_v1', limit: 1000, defaultLimit: 1000, isOverridden: false, min: 200, max: 5000, rankTiming: { samples: 0, p50Ms: null, p95Ms: null } });
      recommendations.describeCandidateLimit.mockResolvedValueOnce({ algo: 'for_you', ranker: 'trip_v1', limit: 2000, defaultLimit: 1000, isOverridden: true, min: 200, max: 5000, rankTiming: { samples: 0, p50Ms: null, p95Ms: null } });
      expect(await controller.setCandidateLimit({ limit: 2000 })).toMatchObject({ limit: 2000, isOverridden: true });
      expect(recommendations.setCandidateLimit).toHaveBeenLastCalledWith(2000);
      await controller.setCandidateLimit({ limit: null });
      expect(recommendations.setCandidateLimit).toHaveBeenLastCalledWith(null);
    });

    it.each([{ limit: 199 }, { limit: 5001 }, { limit: 1000.5 }, { limit: '1000' }, {}])('PUT body sai %o -> 400', async (body) => {
      const { controller, recommendations } = setup();
      await expect(controller.setCandidateLimit(body)).rejects.toBeInstanceOf(BadRequestException);
      expect(recommendations.setCandidateLimit).not.toHaveBeenCalled();
    });

    it('ranker của for_you không đọc nhiều bài -> 400, không ghi', async () => {
      const { controller, recommendations } = setup();
      recommendations.describeCandidateLimit.mockResolvedValueOnce({ algo: 'for_you', ranker: 'tag_affinity_v0', limit: null, defaultLimit: null, isOverridden: false, min: 200, max: 5000, rankTiming: { samples: 0, p50Ms: null, p95Ms: null } });
      await expect(controller.setCandidateLimit({ limit: 1000 })).rejects.toBeInstanceOf(BadRequestException);
      expect(recommendations.setCandidateLimit).not.toHaveBeenCalled();
    });
  });
});
