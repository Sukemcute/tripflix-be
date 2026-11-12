import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { JobRuns, type JobTrigger } from '../../jobs/job-runs.js';
import { RECOMMEND_STORE, type RecommendStore } from '../application/ports.js';

export const PURGE_INTERACTIONS_EVERY_MS = 24 * 3600 * 1000;
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
  isRunning = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(JobRuns) private readonly runs: JobRuns,
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ROLE === 'api' || this.env.NODE_ENV === 'test') return;
    void this.run();
    this.timer = setInterval(() => void this.run(), PURGE_INTERACTIONS_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(trigger: JobTrigger = 'schedule', now = new Date()): Promise<number | null> {
    if (this.isRunning) return null;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const { summary } = await this.runs.track('recommend_purge', trigger, async () => {
        const total = await this.store.withLock(LOCK, async () => {
          let sum = 0;
          for (let n = BATCH; n === BATCH; sum += n) n = await this.store.purgeExpired(now, BATCH);
          return sum;
        });
        return total === null ? { outcome: 'skipped' } : { outcome: 'succeeded', summary: { deleted: total } };
      });
      const deleted = summary?.deleted ?? null;
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
