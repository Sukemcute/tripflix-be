import {
  AccessEmailVerificationRequestedV1Schema,
  AccessRegistrationAttemptedExistingV1Schema,
  AccessRegistrationCodeRequestedV1Schema,
  AccessPasswordResetRequestedV1Schema,
  AccessUserWelcomeEmailRequestedV1Schema,
  CommerceOrderPaidV1Schema,
  CommerceOrderCancelledV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import type { Redis } from 'ioredis';
import { toInboxItemDto, type InboxInsert, type InboxRepository } from '../inbox/inbox.repository.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
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
    private readonly inbox?: Pick<InboxRepository, 'insert' | 'countUnread'>,
    private readonly realtime?: Pick<RealtimeService, 'emitToUser'>,
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
      // Ghi inbox trước email: email lỗi thì sự kiện chạy lại, inbox không nhân đôi (khoá source_event_id);
      // làm ngược lại thì inbox lỗi sẽ gửi email xác nhận hai lần.
      const firstItem = payload.items[0];
      const name = firstItem?.propertyName || firstItem?.productName;
      if (
        await this.createInbox(event, {
          userId: payload.userId,
          type: 'booking.paid',
          title: 'Đặt chỗ thành công',
          body: `Đơn ${payload.confirmationCode || payload.orderId.slice(0, 8)} đã thanh toán ${payload.total.toLocaleString('vi-VN')} VND${name ? ` · ${name}` : ''}`,
          link: '/bookings',
          data: { orderId: payload.orderId },
          sourceEventId: event.eventId,
        })
      )
        result = 'handled';
      // Notification chưa tra được email tài khoản theo userId nên đơn không có email liên hệ thì chưa gửi.
      if (payload.contactEmail) {
        await this.mailer.send(
          buildOrderConfirmationEmail(payload, payload.contactEmail, this.links.webAppUrl),
        );
        result = 'handled';
      }
    } else if (event.type === 'commerce.order.cancelled') {
      const payload = CommerceOrderCancelledV1Schema.parse(event.payload);
      if (
        await this.createInbox(event, {
          userId: payload.userId,
          type: 'booking.cancelled',
          title: 'Đơn đã huỷ',
          body: `Đơn ${payload.confirmationCode || payload.orderId.slice(0, 8)} đã huỷ${payload.refundAmount > 0 ? `, hoàn tiền ${payload.refundAmount.toLocaleString('vi-VN')} VND` : ''}`,
          link: '/bookings',
          data: { orderId: payload.orderId },
          sourceEventId: event.eventId,
        })
      )
        result = 'handled';
    }
    this.log(result === 'handled' ? 'Đã xử lý sự kiện' : 'Đã nhận sự kiện', event);
    await this.processed.mark(event.eventId);
    return result;
  }

  private async createInbox(event: EventEnvelope, item: InboxInsert): Promise<boolean> {
    if (!this.inbox) return false;
    const row = await this.inbox.insert(item);
    if (row && this.realtime) {
      try {
        const unreadCount = await this.inbox.countUnread(item.userId);
        this.realtime.emitToUser(item.userId, 'notification.created', {
          item: toInboxItemDto(row),
          unreadCount,
        });
      } catch {
        // Inbox đã lưu bền vững; client tải lại qua HTTP khi kết nối lại.
        this.log('Không phát được thông báo realtime', event);
      }
    }
    return true;
  }
}
