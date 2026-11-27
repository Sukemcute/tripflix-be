import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { isDue, JobRuns, SCHEDULE_TICK_MS, type JobTrigger } from '../../jobs/job-runs.js';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { EXPLORE_INDEX_INTERVAL_MS, EXPLORE_RECONCILE_INTERVAL_MS, EXPLORE_RECONCILE_MIN_INTERVAL_MS, IndexHealth } from './index-health.js';

/**
 * Dựng lại toàn bộ chỉ mục tìm khám phá theo chu kỳ (admin đổi được qua Redis, xem JobRuns.getIntervalMs). Chạy tay cũng tính
 * là một lượt: lượt tự động kế tiếp đếm từ đó. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * Postgres: lúc khởi động và mỗi 10 phút (bài chỉ vào chỉ mục qua lượt dựng). Typesense: bài đã đồng bộ theo sự kiện content.post.*,
 * lượt dựng chỉ đối soát (khách sạn, điểm OSM, bộ đếm) mỗi 24 giờ; khởi động lại không dựng nếu chỉ mục còn.
 */
@Injectable()
export class RebuildExploreIndexJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RebuildExploreIndexJob.name);
  private timer?: NodeJS.Timeout;
  private lastStartedAt = 0;
  /** Chu kỳ khi admin chưa đặt: Postgres 10 phút; Typesense 24 giờ vì bài đã đồng bộ theo sự kiện. */
  readonly defaultIntervalMs: number;
  private intervalMs: number;
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(ExploreUseCases) private readonly explore: ExploreUseCases,
    @Inject(IndexHealth) private readonly health: IndexHealth,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {
    this.defaultIntervalMs = env.SEARCH_BACKEND === 'typesense' ? EXPLORE_RECONCILE_INTERVAL_MS : EXPLORE_INDEX_INTERVAL_MS;
    this.intervalMs = this.defaultIntervalMs;
  }

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    // Postgres: chạy ngay. Typesense: chỉ mục nằm ngoài tiến trình, khởi động lại không cần dựng lại (mỗi lượt ghi lại cả chỉ mục).
    void (this.env.SEARCH_BACKEND === 'typesense' ? this.resume() : Promise.resolve()).then(() => this.tick());
    this.timer = setInterval(() => void this.tick(), SCHEDULE_TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lấy giờ lượt thành công gần nhất làm mốc nếu chỉ mục còn; mất chỉ mục (volume mới) thì để 0 cho chạy ngay. */
  async resume() {
    try {
      if (!(await this.explore.hasIndex())) return;
      const last = (await this.runs.list('explore')).find((r) => r.outcome === 'succeeded');
      if (last) this.lastStartedAt = last.startedAt;
    } catch (error) {
      this.logger.warn(`Đọc mốc dựng chỉ mục lỗi, dựng lại ngay: ${(error as Error).message}`);
    }
  }

  /** Chạy khi đã qua đủ chu kỳ kể từ lượt trước. */
  async tick() {
    const intervalMs = await this.runs.getIntervalMs('explore', this.defaultIntervalMs);
    this.intervalMs = this.env.SEARCH_BACKEND === 'typesense' ? Math.max(intervalMs, EXPLORE_RECONCILE_MIN_INTERVAL_MS) : intervalMs;
    if (isDue(this.lastStartedAt, this.intervalMs)) await this.run();
  }

  async run(trigger: JobTrigger = 'schedule') {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    this.lastStartedAt = startedAt;
    try {
      await this.runs.track('explore', trigger, async (signal) => {
        this.health.start('explore', startedAt, this.intervalMs);
        const count = await this.explore.rebuildIndex(signal);
        this.health.finish('explore', startedAt, count === null ? 'skipped' : 'succeeded', count ?? undefined);
        if (count === null) {
          this.logger.log('Worker khác đang dựng chỉ mục tìm khám phá, bỏ lượt');
          return { outcome: 'skipped' };
        }
        this.logger.log(`Đã dựng chỉ mục tìm khám phá: ${count} mục trong ${Date.now() - startedAt} ms`);
        return { outcome: 'succeeded', summary: { count } };
      });
    } catch (error) {
      this.health.finish('explore', startedAt, 'failed', undefined, error);
      // Không chặn: /search vẫn chạy trên chỉ mục cũ.
      this.logger.error(`Dựng chỉ mục tìm khám phá lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
