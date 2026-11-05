import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS, type StreamName } from '@tripflix/event-bus';
import { DrizzleOutboxStore, OutboxRelay } from '@tripflix/outbox';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from '../../../../platform/tokens.js';
import { contentOutboxEvents } from '../../db/schema/index.js';

/** Việc chuyển mã đi stream của worker, còn lại đi stream của content. Loại lạ thì báo lỗi, không gửi bừa. */
export function selectContentStream(envelope: EventEnvelope): StreamName {
  if (envelope.type === 'content.media.transcode_requested') return STREAMS.media;
  if (envelope.type.startsWith('content.')) return STREAMS.content;
  throw new Error(`Chưa khai báo stream cho ${envelope.type}`);
}

/** Relay của content: content.outbox_events → Redis Streams. Chỉ chạy khi APP_ROLE là worker hoặc all. */
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
      stream: selectContentStream,
      onError: (err, envelope) =>
        this.logger.error({ err, eventId: envelope?.eventId, type: envelope?.type }, 'Gửi sự kiện content lỗi, sẽ thử lại'),
    });
    this.relay.start();
    this.logger.log('Đã bật relay outbox content');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay?.stop();
  }
}
