import { hostname } from 'node:os';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { MediaRenditionCompletedV1Schema, MediaTranscodeFailedV1Schema, type EventEnvelope } from '@tripflix/contracts';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';
import { MediaResultUseCases } from '../application/media-result.use-cases.js';

const RETRY_START_MS = 5_000;

/** Consumer group "core-media": nhận kết quả của video-worker từ stream:media. Chỉ chạy khi APP_ROLE là worker hoặc all. */
@Injectable()
export class MediaResultConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MediaResultConsumer');
  private consumer: RedisStreamsConsumer | undefined;
  private connection: Redis | undefined;
  private isStopping = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MediaResultUseCases) private readonly results: MediaResultUseCases,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'core-media',
      consumer: hostname(),
      streams: [STREAMS.media],
      handler: (event) => this.route(event),
      onError: (err, delivery) => this.logger.error({ err, ...delivery }, 'Xử lý kết quả chuyển mã lỗi, sẽ thử lại'),
    });
    void this.startWithRetry();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.consumer?.stop();
    this.connection?.disconnect();
  }

  private async route(event: EventEnvelope): Promise<void> {
    if (event.type === 'media.rendition.completed') {
      await this.results.recordRendition(MediaRenditionCompletedV1Schema.parse(event.payload));
    } else if (event.type === 'media.transcode.failed') {
      await this.results.recordFailure(MediaTranscodeFailedV1Schema.parse(event.payload));
    }
    // stream:media còn chứa việc giao cho worker; bỏ qua để chúng được XACK.
  }

  /** Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm app dừng. */
  private async startWithRetry(): Promise<void> {
    while (!this.isStopping && this.consumer) {
      try {
        await this.consumer.start();
        this.logger.log('Đã bật consumer group core-media (stream:media)');
        return;
      } catch (err) {
        this.logger.error({ err }, 'Chưa bật được consumer core-media, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, RETRY_START_MS));
      }
    }
  }
}
