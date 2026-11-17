import { hostname } from 'node:os';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import { ZodError } from 'zod';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';
import { AiUsageUseCases } from '../application/ai-usage.use-cases.js';

const RETRY_START_MS = 5_000;

/**
 * Consumer của group "core-analytics" trên stream:ai (TF95). Ghi mỗi sự kiện ai.usage.recorded thành một dòng chi phí.
 * Ghi theo eventId nên giao lại không đếm trùng. Payload sai hợp đồng thì ghi log rồi bỏ qua: thử lại cũng không sửa được.
 * Lỗi database thì ném để không XACK; quá 5 lần thì thư viện chuyển sang stream:dead-letter.
 * Chỉ chạy khi APP_ROLE là worker hoặc all.
 * Khi làm phần ingest nghe mọi stream (README) cũng bằng group core-analytics: gộp vào consumer đó, đừng để hai consumer
 * cùng group trên stream:ai, vì Redis chia mỗi sự kiện cho một consumer và bên kia sẽ mất sự kiện.
 */
@Injectable()
export class AiUsageConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AiUsageConsumer');
  private consumer: RedisStreamsConsumer | undefined;
  private connection: Redis | undefined;
  private isStopping = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AiUsageUseCases) private readonly usage: AiUsageUseCases,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'core-analytics',
      consumer: hostname(),
      streams: [STREAMS.ai],
      handler: (event) => this.handle(event),
      onError: (err, delivery) => this.logger.error({ err, ...delivery }, 'Ghi chi phí AI lỗi, sẽ thử lại'),
    });
    void this.startWithRetry();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.consumer?.stop();
    this.connection?.disconnect();
  }

  async handle(event: EventEnvelope): Promise<void> {
    try {
      await this.usage.record(event);
    } catch (err) {
      if (!(err instanceof ZodError)) throw err;
      this.logger.warn({ eventId: event.eventId, issues: err.issues.length }, 'Sự kiện chi phí AI sai hợp đồng, bỏ qua');
    }
  }

  // shortcut: chép từ DiscoveryEventsConsumer; libs/event-bus (chủ: Dũng) chưa có hàm dùng chung, khi gom thì đổi sang đó.
  /** Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm app dừng. */
  private async startWithRetry(): Promise<void> {
    while (!this.isStopping && this.consumer) {
      try {
        await this.consumer.start();
        this.logger.log(`Đã bật consumer group core-analytics (${STREAMS.ai})`);
        return;
      } catch (err) {
        this.logger.error({ err }, 'Chưa bật được consumer core-analytics, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, RETRY_START_MS));
      }
    }
  }
}
