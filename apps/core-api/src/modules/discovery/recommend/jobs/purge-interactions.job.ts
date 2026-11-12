import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { RECOMMEND_STORE, type RecommendStore } from '../application/ports.js';

const EVERY_MS = 24 * 3600 * 1000;
const BATCH = 5_000;
const LOCK = 'discovery.recommend-retention';

/**
 * Dọn hạn lưu bảng thô mỗi 24 giờ (và lúc worker khởi động), xoá theo lô 5.000 để không khoá bảng lâu:
 * is_removed quá 7 ngày; share/search/stays_search/view/flight_search quá 90 ngày; còn lại quá 180 ngày.
 * Advisory lock riêng: hai worker cùng chạy thì một bên bỏ lượt.
 */
@Injectable()
export class PurgeInteractionsJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PurgeInteractionsJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.run();
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<number | null> {
    if (this.isRunning) return null;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const deleted = await this.store.withLock(LOCK, async () => {
        let total = 0;
        for (let n = BATCH; n === BATCH; total += n) n = await this.store.purgeExpired(now, BATCH);
        return total;
      });
      if (deleted === null) this.logger.log('Worker khác đang dọn bảng thô gợi ý, bỏ lượt');
      else this.logger.log(`Đã dọn ${deleted} dòng thô gợi ý hết hạn trong ${Date.now() - startedAt} ms`);
      return deleted;
    } catch (error) {
      this.logger.error(`Dọn bảng thô gợi ý lỗi: ${(error as Error).message}`);
      return null;
    } finally {
      this.isRunning = false;
    }
  }
}
