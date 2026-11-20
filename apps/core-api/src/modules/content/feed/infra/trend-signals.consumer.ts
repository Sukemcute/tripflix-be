import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';
import { TrendSignalsUseCases } from '../application/trend-signals.use-cases.js';

const RETRY_START_MS = 5_000;

/**
 * Consumer group "core-feed-trend": lưu lượt xem đủ và bấm đặt từ stream:app-events cho điểm Hot (TF111).
 * Chỉ chạy khi APP_ROLE là worker hoặc all.
 */
@Injectable()
export class TrendSignalsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('TrendSignalsConsumer');
  private consumer: RedisStreamsConsumer | undefined;
  private connection: Redis | undefined;
  private isStopping = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TrendSignalsUseCases) private readonly signals: TrendSignalsUseCases,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'core-feed-trend',
      consumer: hostname(),
      streams: [STREAMS.appEvents],
      handler: (event) => this.signals.recordEvent(event),
      onError: (err, delivery) => this.logger.error({ err, ...delivery }, 'Lưu tín hiệu Hot lỗi, sẽ thử lại'),
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
        this.logger.log('Đã bật consumer group core-feed-trend (stream:app-events)');
        return;
      } catch (err) {
        this.logger.error({ err }, 'Chưa bật được consumer core-feed-trend, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, RETRY_START_MS));
      }
    }
  }
}
