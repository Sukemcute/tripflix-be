import type { EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { DirectoryRepository } from '../directory/directory.repository.js';
import type { ReactionNotificationRepository } from '../grouping/reaction-notification.repository.js';
import type { CommentNotificationRepository } from '../inbox/comment-notification.repository.js';
import type { InboxRepository } from '../inbox/inbox.repository.js';
import type { Mailer } from '../outapp/mailer.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
import { createAccountEmailHandlers } from './handlers/account-email.js';
import { createBookingHandlers } from './handlers/booking.js';
import { createCommentHandlers } from './handlers/comment.js';
import { createDirectoryHandlers } from './handlers/directory.js';
import { createReactionHandlers } from './handlers/reaction-updated.js';
import type { EventHandler } from './handlers/event-handler.js';

/** Trang web mở từ nút "Khám phá ngay" trong email chào mừng khi chưa cấu hình WEB_APP_URL. */
export const DEFAULT_WEB_APP_URL = 'http://localhost:3100';

/** Đánh dấu sự kiện đã xử lý để không gửi trùng (Redis Streams giao ít nhất một lần). */
export interface ProcessedEvents {
  has(eventId: string): Promise<boolean>;
  mark(eventId: string): Promise<void>;
}

const PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisProcessedEvents implements ProcessedEvents {
  constructor(private readonly redis: Pick<Redis, 'exists' | 'set'>) {}

  async has(eventId: string): Promise<boolean> {
    return (await this.redis.exists(`notification:processed:${eventId}`)) === 1;
  }

  async mark(eventId: string): Promise<void> {
    await this.redis.set(`notification:processed:${eventId}`, '1', 'EX', PROCESSED_TTL_SECONDS);
  }
}

export class MemoryProcessedEvents implements ProcessedEvents {
  private readonly ids = new Set<string>();

  async has(eventId: string): Promise<boolean> {
    return this.ids.has(eventId);
  }

  async mark(eventId: string): Promise<void> {
    this.ids.add(eventId);
  }
}

export type RouteResult = 'handled' | 'duplicate' | 'ignored';

/**
 * Chọn việc theo loại sự kiện. Lỗi (ví dụ SMTP) thì ném ra để consumer không XACK và giao lại.
 * Sự kiện chưa có việc thì chỉ ghi log "đã nhận" (walking skeleton, docs/11 §8 bước 7).
 */
export class EventRouter {
  private readonly handlers: Record<string, EventHandler>;

  constructor(
    mailer: Mailer,
    private readonly processed: ProcessedEvents,
    private readonly log: (message: string, event: EventEnvelope) => void,
    links: { webAppUrl: string } = { webAppUrl: DEFAULT_WEB_APP_URL },
    inbox?: Pick<InboxRepository, 'insert' | 'countUnread'>,
    realtime?: Pick<RealtimeService, 'emitToUser'>,
    directory?: Pick<DirectoryRepository, 'upsertUser' | 'upsertPost'>,
    comments?: Pick<CommentNotificationRepository, 'create' | 'hide'>,
    reactions?: Pick<ReactionNotificationRepository, 'apply'>,
  ) {
    this.handlers = {
      ...createAccountEmailHandlers(mailer, links.webAppUrl),
      ...createBookingHandlers({ mailer, webAppUrl: links.webAppUrl, log, inbox, realtime }),
      ...(directory ? createDirectoryHandlers(directory) : {}),
      ...(comments ? createCommentHandlers({ comments, inbox, realtime, log }) : {}),
      ...(reactions ? createReactionHandlers({ reactions, inbox, realtime, log }) : {}),
    };
  }

  async route(event: EventEnvelope): Promise<RouteResult> {
    if (await this.processed.has(event.eventId)) return 'duplicate';
    const handler = this.handlers[`${event.type}.v${event.version}`];
    const handled = handler && (await handler(event));
    this.log(handled ? 'Đã xử lý sự kiện' : 'Đã nhận sự kiện', event);
    await this.processed.mark(event.eventId);
    return handled ? 'handled' : 'ignored';
  }
}
