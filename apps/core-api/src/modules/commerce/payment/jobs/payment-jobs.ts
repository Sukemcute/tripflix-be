import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { DrizzleOutboxStore, OutboxRelay } from '@tripflix/outbox';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../../../platform/tokens.js';
import { commerceOutboxEvents } from '../../db/schema/index.js';
import { PaymentUseCases } from '../application/payment.use-cases.js';

const RECONCILE_EVERY_MS = 30_000;

/**
 * Job nền của thanh toán: đối soát 30 giây/lần và relay outbox commerce → stream:core.commerce.
 * Chỉ chạy khi APP_ROLE là worker hoặc all, để scale API không nhân đôi job.
 */
@Injectable()
export class PaymentJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CommercePaymentJobs');
  private timer?: NodeJS.Timeout;
  private relay?: OutboxRelay;
  private isReconciling = false;

  constructor(
    private readonly payment: PaymentUseCases,
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all')) return;
    this.relay = new OutboxRelay({
      store: new DrizzleOutboxStore(createDb(this.pools.commerce), commerceOutboxEvents),
      bus: new RedisStreamsEventBus(this.redis),
      stream: STREAMS.commerce,
      onError: (err, envelope) => this.logger.error({ err, eventId: envelope?.eventId, type: envelope?.type }, 'Gửi sự kiện commerce lỗi, sẽ thử lại'),
    });
    this.relay.start();
    this.timer = setInterval(() => void this.runReconcile(), RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.relay?.stop();
  }

  async runReconcile() {
    if (this.isReconciling) return;
    this.isReconciling = true;
    try {
      const result = await this.payment.reconcile();
      if (result.settled || result.refunds || result.errors) this.logger.log(result, 'Đối soát thanh toán');
    } catch (error) {
      this.logger.error({ err: error }, 'Đối soát thanh toán lỗi');
    } finally {
      this.isReconciling = false;
    }
  }
}
