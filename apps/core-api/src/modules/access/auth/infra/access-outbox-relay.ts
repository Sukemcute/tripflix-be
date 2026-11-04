import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { DrizzleOutboxStore, OutboxRelay } from '@tripflix/outbox';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../../../platform/tokens.js';
import { accessOutboxEvents } from '../../db/schema/index.js';

/** Relay của access: access.outbox_events → stream:core.access. Chỉ chạy khi APP_ROLE là worker hoặc all. */
@Injectable()
export class AccessOutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AccessOutboxRelay');
  private relay: OutboxRelay | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    this.relay = new OutboxRelay({
      store: new DrizzleOutboxStore(createDb(this.pools.access), accessOutboxEvents),
      bus: new RedisStreamsEventBus(this.redis),
      stream: STREAMS.access,
      onError: (err, envelope) =>
        this.logger.error({ err, eventId: envelope?.eventId, type: envelope?.type }, 'Gửi sự kiện access lỗi, sẽ thử lại'),
    });
    this.relay.start();
    this.logger.log('Đã bật relay outbox access → stream:core.access');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
  }
}
