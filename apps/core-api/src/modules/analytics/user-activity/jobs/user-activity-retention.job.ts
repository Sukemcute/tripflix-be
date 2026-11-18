import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { AI_INSIGHTS_STORE, type AiInsightsStore } from '../../ai-insights/application/ai-insights.store.js';
import { USER_ACTIVITY_STORE, type UserActivityStore } from '../application/user-activity.use-cases.js';
import { retentionCutoff } from '../domain/user-activity.js';

const HOUR_MS = 3_600_000;

/**
 * Xoá hành vi quá 90 ngày và bỏ liên kết người dùng, cuộc trò chuyện, lượt chat ở chi phí AI quá 90 ngày, mỗi giờ một lần
 * (SCRUM-177, SCRUM-179). Số tổng chi phí AI vẫn giữ. Chỉ chạy khi APP_ROLE là worker hoặc all.
 */
@Injectable()
export class UserActivityRetentionJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('UserActivityRetentionJob');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(USER_ACTIVITY_STORE) private readonly store: UserActivityStore,
    @Inject(AI_INSIGHTS_STORE) private readonly aiInsights: AiInsightsStore,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), HOUR_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lỗi database chỉ ghi log: lần chạy sau sẽ thử lại. */
  async runOnce(now: Date = new Date()): Promise<number> {
    try {
      const cutoff = retentionCutoff(now);
      const deleted = await this.store.purgeBefore(cutoff);
      if (deleted > 0) this.logger.log(`Đã xoá ${deleted} dòng hành vi quá 90 ngày`);
      const unlinked = await this.aiInsights.unlinkBefore(cutoff);
      if (unlinked > 0) this.logger.log(`Đã bỏ liên kết người dùng ở ${unlinked} dòng chi phí AI quá 90 ngày`);
      return deleted + unlinked;
    } catch (err) {
      this.logger.error({ err }, 'Dọn dữ liệu hành vi lỗi, sẽ thử lại sau 1 giờ');
      return 0;
    }
  }
}
