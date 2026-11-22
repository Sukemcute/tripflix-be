import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { TrendSignalsUseCases } from '../application/trend-signals.use-cases.js';

export const PURGE_TREND_SIGNALS_EVERY_MS = 24 * 3600 * 1000;

/**
 * Dọn tín hiệu Hot quá 30 ngày, mỗi 24 giờ và lúc worker khởi động. Chỉ chạy khi APP_ROLE là worker hoặc all.
 * Hai worker cùng xoá cũng không sao: câu xoá theo điều kiện thời gian, bên chậm hơn chỉ xoá được ít dòng hơn.
 */
@Injectable()
export class PurgeTrendSignalsJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PurgeTrendSignalsJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(TrendSignalsUseCases) private readonly signals: TrendSignalsUseCases,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all'))
      return;
    void this.run();
    this.timer = setInterval(() => void this.run(), PURGE_TREND_SIGNALS_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const deleted = await this.signals.purgeExpired(now);
      this.logger.log(`Đã dọn ${deleted} tín hiệu Hot hết hạn`);
    } catch (error) {
      this.logger.error({ err: error }, 'Dọn tín hiệu Hot lỗi, lượt sau thử lại');
    } finally {
      this.isRunning = false;
    }
  }
}
