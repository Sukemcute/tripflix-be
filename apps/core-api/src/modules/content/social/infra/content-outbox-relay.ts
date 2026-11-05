import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { DrizzleOutboxStore, OutboxRelay } from '@tripflix/outbox';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../../../platform/tokens.js';
import { contentOutboxEvents } from '../../db/schema/index.js';

/**
 * Relay của module content: content.outbox_events -> Redis Streams.
 * - Sự kiện media.* -> STREAMS.media (stream:media)
 * - Sự kiện content.* -> STREAMS.content (stream:core.content)
 * Kế thừa cơ chế FOR UPDATE SKIP LOCKED từ libs/outbox.
 * Chỉ chạy khi APP_ROLE là worker hoặc all.
 */
@Injectable()
export class ContentOutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ContentOutboxRelay');
  private relay: OutboxRelay | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    this.relay = new OutboxRelay({
      store: new DrizzleOutboxStore(createDb(this.pools.content), contentOutboxEvents),
      bus: new RedisStreamsEventBus(this.redis),
      stream: (envelope) => {
        if (envelope.type === 'content.media.transcode_requested' || envelope.type.startsWith('media.')) return STREAMS.media;
        return STREAMS.content;
      },
      onError: (err, envelope) =>
        this.logger.error(
          { err, eventId: envelope?.eventId, type: envelope?.type },
          'Gửi sự kiện content lỗi, sẽ thử lại',
        ),
    });
    this.relay.start();
    this.logger.log('Đã bật relay outbox content -> Redis Streams (media/content)');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
  }
}
