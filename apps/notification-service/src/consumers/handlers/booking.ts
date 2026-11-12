import { CommerceOrderCancelledV1Schema, CommerceOrderPaidV1Schema, type EventEnvelope } from '@tripflix/contracts';
import { toInboxItemDto, type InboxInsert, type InboxRepository } from '../../inbox/inbox.repository.js';
import type { Mailer } from '../../outapp/mailer.js';
import { buildOrderConfirmationEmail } from '../../outapp/order-confirmation.email.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import type { EventHandler } from './event-handler.js';

export function createBookingHandlers(options: {
  mailer: Mailer;
  webAppUrl: string;
  log: (message: string, event: EventEnvelope) => void;
  inbox: Pick<InboxRepository, 'insert' | 'countUnread'> | undefined;
  realtime: Pick<RealtimeService, 'emitToUser'> | undefined;
}): Record<string, EventHandler> {
  async function createInbox(event: EventEnvelope, item: InboxInsert): Promise<boolean> {
    const { inbox, realtime } = options;
    if (!inbox) return false;
    const row = await inbox.insert(item);
    if (row && realtime) {
      try {
        const unreadCount = await inbox.countUnread(item.userId);
        realtime.emitToUser(item.userId, 'notification.created', { item: toInboxItemDto(row), unreadCount });
      } catch {
        options.log('Không phát được thông báo realtime', event);
      }
    }
    return true;
  }

  return {
    'commerce.order.paid.v1': async (event) => {
      const payload = CommerceOrderPaidV1Schema.parse(event.payload);
      const firstItem = payload.items[0];
      const name = firstItem?.propertyName || firstItem?.productName;
      // Ghi inbox trước để có thể thử lại nếu SMTP lỗi.
      const hasInbox = await createInbox(event, {
        userId: payload.userId,
        type: 'booking.paid',
        title: 'Đặt chỗ thành công',
        body: `Đơn ${payload.confirmationCode || payload.orderId.slice(0, 8)} đã thanh toán ${payload.total.toLocaleString('vi-VN')} VND${name ? ` · ${name}` : ''}`,
        link: '/bookings',
        data: { orderId: payload.orderId },
        sourceEventId: event.eventId,
      });
      if (!payload.contactEmail) return hasInbox;
      await options.mailer.send(buildOrderConfirmationEmail(payload, payload.contactEmail, options.webAppUrl));
      return true;
    },
    'commerce.order.cancelled.v1': async (event) => {
      const payload = CommerceOrderCancelledV1Schema.parse(event.payload);
      return createInbox(event, {
        userId: payload.userId,
        type: 'booking.cancelled',
        title: 'Đơn đã huỷ',
        body: `Đơn ${payload.confirmationCode || payload.orderId.slice(0, 8)} đã huỷ${payload.refundAmount > 0 ? `, hoàn tiền ${payload.refundAmount.toLocaleString('vi-VN')} VND` : ''}`,
        link: '/bookings',
        data: { orderId: payload.orderId },
        sourceEventId: event.eventId,
      });
    },
  };
}
