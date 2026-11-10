import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';
import { ScreenContentUseCase } from '../application/moderation.use-cases.js';

@Injectable()
export class ScreeningConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ScreeningConsumer');
  private consumer?: RedisStreamsConsumer;
  private connection?: Redis;
  private stopping = false;
  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ScreenContentUseCase) private readonly screen: ScreenContentUseCase,
  ) {}
  onApplicationBootstrap(): void {
    if (!['worker', 'all'].includes(this.env.APP_ROLE)) return;
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'core-moderation',
      consumer: `${hostname()}-${process.pid}`,
      streams: [STREAMS.content],
      handler: (event) => this.route(event),
      onError: (_err, delivery) => this.logger.error({ ...delivery }, 'Kiểm duyệt lỗi, chờ giao lại sự kiện'),
    });
    void this.start();
  }
  async route(event: EventEnvelope): Promise<void> {
    if (event.version !== 1) return;
    if (['content.post.published', 'content.post.updated'].includes(event.type)) {
      await this.screen.execute(
        event.eventId,
        'post',
        z.object({ postId: z.uuid() }).parse(event.payload).postId,
        event.occurredAt,
      );
    } else if (['content.comment.created', 'content.comment.updated'].includes(event.type)) {
      await this.screen.execute(
        event.eventId,
        'comment',
        z.object({ commentId: z.uuid() }).parse(event.payload).commentId,
        event.occurredAt,
      );
    }
  }
  private async start() {
    while (!this.stopping) {
      try {
        await this.consumer?.start();
        return;
      } catch {
        this.logger.error('Chưa bật được core-moderation, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.consumer?.stop();
    this.connection?.disconnect();
  }
}
