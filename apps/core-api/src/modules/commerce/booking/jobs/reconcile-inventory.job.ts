import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { ReconcileInventoryUseCases } from '../application/reconcile-inventory.use-cases.js';

const EVERY_MS = 60 * 60_000;

/** Đối soát tồn kho với đơn (K4), mỗi giờ. Chỉ chạy khi APP_ROLE là worker hoặc all. */
@Injectable()
export class ReconcileInventoryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcileInventoryJob.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly reconcileInventory: ReconcileInventoryUseCases,
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
      await this.reconcileInventory.reconcile();
    } catch (error) {
      this.logger.error({ err: error }, 'Đối soát tồn kho lỗi');
    } finally {
      this.isRunning = false;
    }
  }
}
