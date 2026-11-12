import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import type { Mailer } from '../outapp/mailer.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ENV, MAILER, PROCESSED_EVENTS, REDIS } from '../tokens.js';
import { DeadLetterReplayer } from './dead-letter-replay.js';
import { EventRouter, type ProcessedEvents } from './event-router.js';

@Injectable()
export class DeadLetterReplayJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DeadLetterReplayJob');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(PROCESSED_EVENTS) private readonly processed: ProcessedEvents,
    @Inject(InboxRepository) private readonly inbox: InboxRepository,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
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
    );
    const replayer = new DeadLetterReplayer(this.redis, router, Date.now, {
      onError: (err, event) =>
        this.logger.error({ err, eventId: event.eventId }, 'Gửi lại sự kiện lỗi, sẽ thử lại'),
    });
    this.timer = setInterval(() => {
      // SMTP chậm không được tạo thêm lượt gửi chồng lên nhau.
      if (this.running) return;
      this.running = this.runOnce(replayer).finally(() => {
        this.running = undefined;
      });
    }, this.env.NOTIFICATION_DLQ_REPLAY_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private async runOnce(replayer: DeadLetterReplayer): Promise<void> {
    try {
      const counts = await replayer.replayOnce();
      // Sự kiện đã gửi xong vẫn nằm trong hàng đợi lỗi, nên chỉ ghi log khi có lượt gửi thật.
      if (counts.replayed || counts.failed) {
        this.logger.log(counts, 'Đã quét hàng đợi sự kiện lỗi');
      }
    } catch (err) {
      this.logger.error({ err }, 'Chưa quét được hàng đợi sự kiện lỗi');
    }
  }
}
