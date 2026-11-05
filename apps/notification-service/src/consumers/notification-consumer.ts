import { hostname } from 'node:os';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import type { Mailer } from '../outapp/mailer.js';
import { ENV, MAILER, PROCESSED_EVENTS, REDIS } from '../tokens.js';
import { EventRouter, type ProcessedEvents } from './event-router.js';

/** Consumer group "notification": nghe sự kiện của core, gửi email, ghi log. */
@Injectable()
export class NotificationConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('NotificationConsumer');
  private consumer: RedisStreamsConsumer | undefined;
  private connection: Redis | undefined;
  private isStopping = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(PROCESSED_EVENTS) private readonly processed: ProcessedEvents,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_CONSUMER_ENABLED) return;
    const router = new EventRouter(
      this.mailer,
      this.processed,
      (message, event) =>
        this.logger.log({ eventId: event.eventId, type: event.type, producer: event.producer }, message),
      { webAppUrl: this.env.WEB_APP_URL },
    );
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'notification',
      consumer: this.env.NOTIFICATION_CONSUMER_NAME ?? hostname(),
      streams: [STREAMS.access, STREAMS.content, STREAMS.commerce],
      handler: async (event) => {
        await router.route(event);
      },
      onError: (err, delivery) => this.logger.error({ err, ...delivery }, 'Xử lý sự kiện lỗi, sẽ thử lại'),
    });
    void this.startWithRetry();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.consumer?.stop();
    this.connection?.disconnect();
  }

  /** Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm app dừng. */
  private async startWithRetry(): Promise<void> {
    while (!this.isStopping && this.consumer) {
      try {
        await this.consumer.start();
        this.logger.log('Đã bật consumer group notification (stream:core.access, content, commerce)');
        return;
      } catch (err) {
        this.logger.error({ err }, 'Chưa bật được consumer, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
}
