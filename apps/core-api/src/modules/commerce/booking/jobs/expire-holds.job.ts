import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { ExpireHoldsUseCases } from '../application/expire-holds.use-cases.js';

const EVERY_MS = 60_000;

/** Nhả chỗ của đơn quá hạn giữ, mỗi phút. Chỉ chạy khi APP_ROLE là worker hoặc all, để scale API không nhân đôi job. */
@Injectable()
export class ExpireHoldsJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExpireHoldsJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly expireHolds: ExpireHoldsUseCases,
    @Inject(CORE_ENV) private readonly env: CoreEnv,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all')) return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const result = await this.expireHolds.expireHolds();
      if (result.expired || result.errors) this.logger.log(result, 'Nhả chỗ quá hạn');
    } catch (error) {
      this.logger.error({ err: error }, 'Nhả chỗ quá hạn lỗi');
    } finally {
      this.isRunning = false;
    }
  }
}
