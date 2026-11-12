import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  AccessUserLockedV1Schema,
  AccessUserRoleChangedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import { RedisStreamsConsumer, STREAMS } from '@tripflix/event-bus';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import type { Mailer } from '../outapp/mailer.js';
import { ReactionNotificationRepository } from '../grouping/reaction-notification.repository.js';
import { CommentNotificationRepository } from '../inbox/comment-notification.repository.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { DirectoryRepository } from '../directory/directory.repository.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ENV, MAILER, PROCESSED_EVENTS, REDIS } from '../tokens.js';
import { EventRouter, type ProcessedEvents } from './event-router.js';

/** Sự kiện mà access đã thu hồi mọi phiên của người dùng (staff.use-cases: blockSessions). */
const SESSIONS_REVOKED_SCHEMAS = {
  'access.user.locked': AccessUserLockedV1Schema,
  'access.user.role_changed': AccessUserRoleChangedV1Schema,
} as const;

/**
 * Bị khoá hoặc đổi vai trò thì access đã thu hồi mọi phiên: ngắt luôn mọi kết nối /ws của người đó ở mọi replica,
 * không chờ tới lúc access token hết hạn. Sid đã bị chặn nên không kết nối lại bằng token cũ được.
 * Ngắt lại nhiều lần cũng không sao, nên không cần chống trùng.
 */
export function disconnectRevokedUser(
  event: EventEnvelope,
  realtime: Pick<RealtimeService, 'disconnectUser'>,
): boolean {
  const schema = SESSIONS_REVOKED_SCHEMAS[event.type as keyof typeof SESSIONS_REVOKED_SCHEMAS];
  if (!schema) return false;
  const payload = schema.safeParse(event.payload);
  if (!payload.success) return false;
  realtime.disconnectUser(payload.data.userId);
  return true;
}

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
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(InboxRepository) private readonly inbox: InboxRepository,
    @Inject(DirectoryRepository) private readonly directory: DirectoryRepository,
    @Inject(CommentNotificationRepository) private readonly comments: CommentNotificationRepository,
    @Inject(ReactionNotificationRepository) private readonly reactions: ReactionNotificationRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_CONSUMER_ENABLED) return;
    const router = new EventRouter(
      this.mailer,
      this.processed,
      (message, event) =>
        this.logger.log({ eventId: event.eventId, type: event.type, producer: event.producer }, message),
      { webAppUrl: this.env.WEB_APP_URL },
      this.inbox,
      this.realtime,
      this.directory,
      this.comments,
      this.reactions,
    );
    // XREADGROUP BLOCK giữ kết nối, nên dùng kết nối riêng.
    this.connection = this.redis.duplicate();
    this.consumer = new RedisStreamsConsumer({
      redis: this.connection,
      group: 'notification',
      // Chờ SMTP phục hồi khoảng 10 phút trước khi chuyển sang hàng đợi lỗi.
      maxDeliveries: 10,
      consumer: this.env.NOTIFICATION_CONSUMER_NAME ?? hostname(),
      streams: [STREAMS.access, STREAMS.content, STREAMS.commerce],
      handler: async (event) => {
        disconnectRevokedUser(event, this.realtime);
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
