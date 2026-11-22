import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { TrendScoresUseCases } from '../application/trend-scores.use-cases.js';

/** Xu hướng trễ tối đa chừng này (docs/10, D7). */
export const COMPUTE_TREND_SCORES_EVERY_MS = 5 * 60 * 1000;

/**
 * Chấm điểm Hot mỗi 5 phút, và ngay lúc worker khởi động để tab hot không trống sau lần deploy đầu.
 * Chỉ chạy khi APP_ROLE là worker hoặc all. Hai worker cùng chấm cũng ra cùng kết quả, bản ghi sau thắng.
 */
@Injectable()
export class ComputeTrendScoresJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ComputeTrendScoresJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(TrendScoresUseCases) private readonly scores: TrendScoresUseCases,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all')) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), COMPUTE_TREND_SCORES_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const count = await this.scores.recompute(now);
      this.logger.log(`Đã chấm điểm Hot ${count} bài trong ${Date.now() - startedAt} ms`);
    } catch (error) {
      this.logger.error({ err: error }, 'Chấm điểm Hot lỗi, lượt sau thử lại');
    } finally {
      this.isRunning = false;
    }
  }
}
