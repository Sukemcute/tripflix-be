import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { JobRuns, SCHEDULE_TICK_MS, type JobTrigger } from '../../jobs/job-runs.js';
import { BuildFeaturesUseCases } from '../application/build-features.use-cases.js';

export const BUILD_FEATURES_EVERY_MS = 10 * 60 * 1000;

/**
 * Tính đặc trưng gợi ý lúc worker khởi động và mỗi chu kỳ (mặc định 10 phút, admin đổi được qua Redis, xem
 * JobRuns.getIntervalMs). Chạy tay cũng tính là một lượt. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * ponytail: dựng lại toàn bộ mỗi chu kỳ (pilot < 1 giây); cộng dồn theo watermark + ingested_at khi lên hàng chục nghìn bài.
 */
@Injectable()
export class BuildFeaturesJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BuildFeaturesJob.name);
  private timer?: NodeJS.Timeout;
  private lastStartedAt = 0;
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(BuildFeaturesUseCases) private readonly features: BuildFeaturesUseCases,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.tick(); // lastStartedAt = 0: chạy ngay
    this.timer = setInterval(() => void this.tick(), SCHEDULE_TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Chạy khi đã qua đủ chu kỳ kể từ lượt trước. */
  async tick() {
    const intervalMs = await this.runs.getIntervalMs('recommend_build', BUILD_FEATURES_EVERY_MS);
    if (Date.now() - this.lastStartedAt >= intervalMs) await this.run();
  }

  async run(trigger: JobTrigger = 'schedule') {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    this.lastStartedAt = startedAt;
    try {
      await this.runs.track('recommend_build', trigger, async () => {
        const result = await this.features.runCycle();
        if (result === null) {
          this.logger.log('Worker khác đang tính đặc trưng gợi ý (hoặc chưa có bài), bỏ lượt');
          return { outcome: 'skipped' };
        }
        this.logger.log({ ...result, durationMs: Date.now() - startedAt }, `Đã tính đặc trưng gợi ý: ${result.posts} bài, ${result.users} người trong ${Date.now() - startedAt} ms`);
        const failed = result.failedBuilders.length ? { error: `Builder lỗi: ${result.failedBuilders.join(', ')}` } : {};
        return { outcome: 'succeeded', summary: result, ...failed };
      });
    } catch (error) {
      // Không chặn: endpoint vẫn chạy trên đặc trưng cũ.
      this.logger.error(`Tính đặc trưng gợi ý lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
