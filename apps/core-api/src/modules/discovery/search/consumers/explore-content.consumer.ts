import { hostname } from 'node:os';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, REDIS } from '../../../../platform/tokens.js';
import { ExploreUseCases } from '../application/explore.use-cases.js';

const RETRY_START_MS = 5_000;
/**
 * Sự kiện có thể làm bài thôi hiện công khai. Không đọc action/status trong payload mà hỏi lại Content (dropHidden),
 * nên event cũ, trùng hay đến lệch thứ tự (hide rồi restore) đều không xoá nhầm bài đang hiện.
 * content.post.updated: sửa bài đã đăng, có thể đổi visibility sang private.
 */
const POST_EVENTS = new Set(['content.post.moderated', 'content.post.deleted', 'content.post.updated']);

/**
 * Consumer group "core-discovery": gỡ bài bị ẩn/xoá khỏi chỉ mục tìm khám phá trong vài giây, không chờ job 10 phút.
 * Chỉ chạy khi APP_ROLE là worker hoặc all. Lỗi quá 5 lần thì thư viện chuyển sang stream:dead-letter.
 */
@Injectable()
export class ExploreContentConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ExploreContentConsumer');
  private consumer: RedisStreamsConsumer | undefined;
  private connection: Redis | undefined;
  private isStopping = false;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ExploreUseCases) private readonly explore: ExploreUseCases,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'core-discovery',
      consumer: hostname(),
      streams: [STREAMS.content],
      handler: (event) => this.route(event),
      onError: (err, delivery) => this.logger.error({ err, ...delivery }, 'Gỡ bài khỏi chỉ mục tìm kiếm lỗi, sẽ thử lại'),
    });
    void this.startWithRetry();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.consumer?.stop();
    this.connection?.disconnect();
  }

  async route(event: EventEnvelope): Promise<void> {
    // stream:core.content còn nhiều sự kiện khác (comment, reaction...); bỏ qua để chúng được XACK.
    if (!POST_EVENTS.has(event.type)) return;
    const postId = (event.payload as { postId?: unknown } | null)?.postId;
    if (typeof postId !== 'string' || !postId) {
      // Thử lại cũng không sửa được payload hỏng: ghi log rồi bỏ qua.
      this.logger.warn({ eventId: event.eventId, type: event.type }, 'Sự kiện bài thiếu postId, bỏ qua');
      return;
    }
    const removed = await this.explore.dropHidden([postId]);
    if (removed) this.logger.log(`Đã gỡ bài ${postId} khỏi chỉ mục tìm kiếm (${event.type})`);
  }

  // ponytail: chép từ MediaResultConsumer; consumer thứ ba thì gom vào libs/event-bus.
  /** Redis chưa sẵn sàng lúc khởi động thì thử lại, không làm app dừng. */
  private async startWithRetry(): Promise<void> {
    while (!this.isStopping && this.consumer) {
      try {
        await this.consumer.start();
        this.logger.log('Đã bật consumer group core-discovery (stream:core.content)');
        return;
      } catch (err) {
        this.logger.error({ err }, 'Chưa bật được consumer core-discovery, thử lại sau 5 giây');
        await new Promise((resolve) => setTimeout(resolve, RETRY_START_MS));
      }
    }
  }
}
