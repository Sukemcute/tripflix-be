import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { JobRuns, type JobTrigger } from '../../jobs/job-runs.js';
import { BuildFeaturesUseCases } from '../application/build-features.use-cases.js';

export const BUILD_FEATURES_EVERY_MS = 10 * 60 * 1000;

/**
 * Tính đặc trưng gợi ý lúc worker khởi động và mỗi 10 phút. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * ponytail: dựng lại toàn bộ mỗi chu kỳ (pilot < 1 giây); cộng dồn theo watermark + ingested_at khi lên hàng chục nghìn bài.
 */
@Injectable()
export class BuildFeaturesJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BuildFeaturesJob.name);
  private timer?: NodeJS.Timeout;
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(BuildFeaturesUseCases) private readonly features: BuildFeaturesUseCases,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.run();
    this.timer = setInterval(() => void this.run(), BUILD_FEATURES_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(trigger: JobTrigger = 'schedule') {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
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
