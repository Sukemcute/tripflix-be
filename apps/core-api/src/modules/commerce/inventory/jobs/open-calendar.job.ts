import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { CalendarUseCases } from '../application/calendar.use-cases.js';

const EVERY_MS = 6 * 60 * 60 * 1000;

/** Mở lịch trống cho đủ 180 ngày tới, 6 giờ/lần. Chỉ chạy khi APP_ROLE là worker hoặc all, để scale API không nhân đôi job. */
@Injectable()
export class OpenCalendarJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OpenCalendarJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly calendar: CalendarUseCases,
    @Inject(CORE_ENV) private readonly env: CoreEnv,
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

  async run() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const opened = await this.calendar.openCalendarWindow();
      this.logger.log(`Đã mở thêm ${opened.roomDays} ngày phòng, ${opened.flightDays} ngày bay`);
    } catch (error) {
      this.logger.error(`Mở lịch trống lỗi: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
