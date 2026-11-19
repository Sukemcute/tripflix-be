import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { DepartureReminderUseCases } from '../application/departure-reminder.use-cases.js';
import { TraceContext } from '../../trace-context.js';

const EVERY_MS = 5 * 60_000;

/** Nhắc khách 24 giờ trước chuyến (TF37), mỗi 5 phút. Chỉ chạy khi APP_ROLE là worker hoặc all, để scale API không nhân đôi job. */
@Injectable()
export class DepartureReminderJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DepartureReminderJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly reminders: DepartureReminderUseCases,
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(TraceContext) private readonly trace: TraceContext,
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
      const result = await this.trace.runJob('departure-reminder', () => this.reminders.remindDepartures());
      if (result.reminded || result.errors) this.logger.log(result, 'Nhắc khách trước chuyến');
    } catch (error) {
      this.logger.error({ err: error }, 'Nhắc chuyến lỗi');
    } finally {
      this.isRunning = false;
    }
  }
}
