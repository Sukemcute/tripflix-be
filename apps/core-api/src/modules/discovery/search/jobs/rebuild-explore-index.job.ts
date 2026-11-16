import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { JobRuns, SCHEDULE_TICK_MS, type JobTrigger } from '../../jobs/job-runs.js';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { EXPLORE_INDEX_INTERVAL_MS, IndexHealth } from './index-health.js';

/**
 * Dựng lại chỉ mục tìm khám phá lúc worker khởi động và mỗi chu kỳ (mặc định 10 phút, admin đổi được qua Redis,
 * xem JobRuns.getIntervalMs). Chạy tay cũng tính là một lượt: lượt tự động kế tiếp đếm từ đó. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * ponytail: dựng lại toàn bộ (~230 mục, dưới 1 giây) thay vì cộng dồn từng bài — listPosts không báo bài bị ẩn/xoá.
 * Đổi sang cộng dồn (cursor updatedAfter + sự kiện content.post.*) khi dữ liệu lên vài chục nghìn mục.
 */
@Injectable()
export class RebuildExploreIndexJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RebuildExploreIndexJob.name);
  private timer?: NodeJS.Timeout;
  private lastStartedAt = 0;
  private intervalMs = EXPLORE_INDEX_INTERVAL_MS;
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(ExploreUseCases) private readonly explore: ExploreUseCases,
    @Inject(IndexHealth) private readonly health: IndexHealth,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.tick(); // lastStartedAt = 0: chạy ngay, kèm chu kỳ đọc được
    this.timer = setInterval(() => void this.tick(), SCHEDULE_TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Chạy khi đã qua đủ chu kỳ kể từ lượt trước. */
  async tick() {
    this.intervalMs = await this.runs.getIntervalMs('explore', EXPLORE_INDEX_INTERVAL_MS);
    if (Date.now() - this.lastStartedAt >= this.intervalMs) await this.run();
  }

  async run(trigger: JobTrigger = 'schedule') {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    this.lastStartedAt = startedAt;
    try {
      await this.runs.track('explore', trigger, async () => {
        this.health.start('explore', startedAt, this.intervalMs);
        const count = await this.explore.rebuildIndex();
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
