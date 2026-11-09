import {
  AccessEmailVerificationRequestedV1Schema,
  AccessRegistrationAttemptedExistingV1Schema,
  AccessRegistrationCodeRequestedV1Schema,
  AccessPasswordResetRequestedV1Schema,
  AccessUserWelcomeEmailRequestedV1Schema,
  CommerceOrderPaidV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import type { Mailer } from '../outapp/mailer.js';
import { buildEmailVerificationEmail } from '../outapp/email-verification.email.js';
import { buildExistingAccountEmail } from '../outapp/existing-account.email.js';
import { buildRegistrationCodeEmail } from '../outapp/registration-code.email.js';
import { buildOrderConfirmationEmail } from '../outapp/order-confirmation.email.js';
import { buildPasswordResetEmail } from '../outapp/password-reset.email.js';
import { buildWelcomeEmail } from '../outapp/welcome.email.js';

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
  constructor(
    private readonly mailer: Mailer,
    private readonly processed: ProcessedEvents,
    private readonly log: (message: string, event: EventEnvelope) => void,
    private readonly links: { webAppUrl: string } = { webAppUrl: DEFAULT_WEB_APP_URL },
  ) {}

  async route(event: EventEnvelope): Promise<RouteResult> {
    if (await this.processed.has(event.eventId)) return 'duplicate';
    let result: RouteResult = 'ignored';
    if (event.type === 'access.password_reset_requested') {
      const payload = AccessPasswordResetRequestedV1Schema.parse(event.payload);
      await this.mailer.send(buildPasswordResetEmail(payload));
      result = 'handled';
    } else if (event.type === 'access.registration_code_requested') {
      const payload = AccessRegistrationCodeRequestedV1Schema.parse(event.payload);
      await this.mailer.send(buildRegistrationCodeEmail(payload));
      result = 'handled';
    } else if (event.type === 'access.registration_attempted_existing') {
      const payload = AccessRegistrationAttemptedExistingV1Schema.parse(event.payload);
      await this.mailer.send(buildExistingAccountEmail(payload, this.links.webAppUrl));
      result = 'handled';
    } else if (event.type === 'access.email_verification_requested') {
      const payload = AccessEmailVerificationRequestedV1Schema.parse(event.payload);
      await this.mailer.send(buildEmailVerificationEmail(payload));
      result = 'handled';
    } else if (event.type === 'access.user.welcome_email_requested') {
      const payload = AccessUserWelcomeEmailRequestedV1Schema.parse(event.payload);
      await this.mailer.send(buildWelcomeEmail(payload, this.links.webAppUrl));
      result = 'handled';
    } else if (event.type === 'commerce.order.paid') {
      const payload = CommerceOrderPaidV1Schema.parse(event.payload);
      // Notification chưa tra được email tài khoản theo userId nên đơn không có email liên hệ thì chưa gửi.
      if (payload.contactEmail) {
        await this.mailer.send(buildOrderConfirmationEmail(payload, payload.contactEmail));
        result = 'handled';
      }
    }
    this.log(result === 'handled' ? 'Đã xử lý sự kiện' : 'Đã nhận sự kiện', event);
    await this.processed.mark(event.eventId);
    return result;
  }
}
