import { AccessPasswordResetRequestedV1Schema, type EventEnvelope } from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { Mailer } from '../outapp/mailer.js';
import { buildPasswordResetEmail } from '../outapp/password-reset.email.js';

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
  constructor(
    private readonly mailer: Mailer,
    private readonly processed: ProcessedEvents,
    private readonly log: (message: string, event: EventEnvelope) => void,
  ) {}

  async route(event: EventEnvelope): Promise<RouteResult> {
    if (await this.processed.has(event.eventId)) return 'duplicate';
    let result: RouteResult = 'ignored';
    if (event.type === 'access.password_reset_requested') {
      const payload = AccessPasswordResetRequestedV1Schema.parse(event.payload);
      await this.mailer.send(buildPasswordResetEmail(payload));
      result = 'handled';
    }
    this.log(result === 'handled' ? 'Đã xử lý sự kiện' : 'Đã nhận sự kiện', event);
    await this.processed.mark(event.eventId);
    return result;
  }
}
