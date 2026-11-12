import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { JobRuns, type JobTrigger } from '../../jobs/job-runs.js';
import { SuggestUseCases } from '../application/suggest.use-cases.js';
import { IndexHealth } from './index-health.js';

/**
 * Dựng lại chỉ mục gợi ý mỗi lần worker khởi động (vài trăm dòng, dưới một giây).
 * ponytail: chưa có sự kiện commerce.ari.updated nên khách sạn mới chỉ vào gợi ý sau lần khởi động kế tiếp;
 * thêm consumer khi commerce phát sự kiện.
 */
@Injectable()
export class RebuildSuggestIndexJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(RebuildSuggestIndexJob.name);
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(SuggestUseCases) private readonly suggestions: SuggestUseCases,
    @Inject(IndexHealth) private readonly health: IndexHealth,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.APP_ROLE === 'api') return;
    await this.run();
  }

  async run(trigger: JobTrigger = 'schedule'): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      await this.runs.track('suggest', trigger, async () => {
        this.health.start('suggest', startedAt);
        const count = await this.suggestions.rebuildIndex();
        this.health.finish('suggest', startedAt, 'succeeded', count);
        this.logger.log(`Đã dựng chỉ mục gợi ý: ${count} dòng trong ${Date.now() - startedAt} ms`);
        return { outcome: 'succeeded', summary: { count } };
      });
    } catch (error) {
      this.health.finish('suggest', startedAt, 'failed', undefined, error);
      // Không chặn khởi động: /suggest vẫn chạy trên chỉ mục cũ.
      this.logger.error(`Dựng chỉ mục gợi ý lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
