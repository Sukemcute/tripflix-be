import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { USER_ACTIVITY_STORE, type UserActivityStore } from '../application/user-activity.use-cases.js';
import { retentionCutoff } from '../domain/user-activity.js';

const HOUR_MS = 3_600_000;

/** Xoá hành vi quá 90 ngày, mỗi giờ một lần (TF177). Chỉ chạy khi APP_ROLE là worker hoặc all. */
@Injectable()
export class UserActivityRetentionJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('UserActivityRetentionJob');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(USER_ACTIVITY_STORE) private readonly store: UserActivityStore,
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
      const deleted = await this.store.purgeBefore(retentionCutoff(now));
      if (deleted > 0) this.logger.log(`Đã xoá ${deleted} dòng hành vi quá 90 ngày`);
      return deleted;
    } catch (err) {
      this.logger.error({ err }, 'Dọn dữ liệu hành vi lỗi, sẽ thử lại sau 1 giờ');
      return 0;
    }
  }
}
