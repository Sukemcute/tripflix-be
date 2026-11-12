import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import type { InboxInsert, InboxRow } from '../inbox/inbox.repository.js';
import { MemoryMailer } from '../outapp/mailer.js';
import { EventRouter, MemoryProcessedEvents } from './event-router.js';

function createEvent(type = 'commerce.order.paid'): EventEnvelope {
  return {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api/commerce',
    userId: null,
    payload: {
      orderId: randomUUID(),
      userId: randomUUID(),
      total: 2_850_000,
      sourcePostId: null,
      confirmationCode: 'TF-ABC123',
      contactEmail: 'an@example.com',
      contactName: 'An',
      items: [
        {
          productType: 'room',
          productId: 'P-1',
          date: '2026-12-01',
          nights: 2,
          qty: 1,
          propertyName: 'Khách sạn Biển',
          productName: 'Deluxe',
        },
      ],
      refundAmount: 2_000_000,
      feeAmount: 850_000,
    },
  };
}

function setup() {
  const processed = new MemoryProcessedEvents();
  const mailer = new MemoryMailer();
  const log = vi.fn();
  const insert = vi.fn(async (item: InboxInsert): Promise<InboxRow | null> => ({
    id: randomUUID(),
    user_id: item.userId,
    type: item.type,
    title: item.title,
    body: item.body,
    link: item.link,
    data: item.data,
    source_event_id: item.sourceEventId,
    created_at: new Date('2026-11-12T00:00:00Z'),
    read_at: null,
  }));
  const countUnread = vi.fn(async () => 3);
  const emitToUser = vi.fn(() => true);
  const router = new EventRouter(mailer, processed, log, undefined, { insert, countUnread }, { emitToUser });
  return { router, mailer, processed, insert, countUnread, emitToUser, log };
}

describe('Thông báo hộp thư cho đặt chỗ', () => {
  it('paid lưu inbox, phát DTO realtime và vẫn gửi email; giao lại không làm gì', async () => {
    const { router, insert, emitToUser, mailer } = setup();
    const event = createEvent();
    expect(await router.route(event)).toBe('handled');
    expect(insert).toHaveBeenCalledWith({
      userId: event.payload.userId,
      type: 'booking.paid',
      title: 'Đặt chỗ thành công',
      body: 'Đơn TF-ABC123 đã thanh toán 2.850.000 VND · Khách sạn Biển',
      link: '/bookings',
      data: { orderId: event.payload.orderId },
      sourceEventId: event.eventId,
    });
    expect(emitToUser).toHaveBeenCalledWith(event.payload.userId, 'notification.created', {
      item: expect.objectContaining({
        type: 'booking.paid',
        createdAt: '2026-11-12T00:00:00.000Z',
        readAt: null,
      }),
      unreadCount: 3,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(await router.route(event)).toBe('duplicate');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('cancelled lưu tiền hoàn, phát realtime và không gửi email', async () => {
    const { router, insert, emitToUser, mailer } = setup();
    expect(await router.route(createEvent('commerce.order.cancelled'))).toBe('handled');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'booking.cancelled',
        title: 'Đơn đã huỷ',
        body: 'Đơn TF-ABC123 đã huỷ, hoàn tiền 2.000.000 VND',
      }),
    );
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(mailer.sent).toHaveLength(0);
  });

  it('không có email vẫn tạo inbox, dùng mã đơn rút gọn và productName', async () => {
    const { router, insert, mailer } = setup();
    const event = createEvent();
    event.payload = {
      ...event.payload,
      contactEmail: null,
      confirmationCode: null,
      items: [
        {
          productType: 'room',
          productId: 'P-1',
          date: '2026-12-01',
          nights: 1,
          qty: 1,
          productName: 'Deluxe',
        },
      ],
    };
    expect(await router.route(event)).toBe('handled');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: `Đơn ${String(event.payload.orderId).slice(0, 8)} đã thanh toán 2.850.000 VND · Deluxe`,
      }),
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it('không nhắc tiền hoàn khi huỷ có refundAmount bằng 0', async () => {
    const { router, insert } = setup();
    const event = createEvent('commerce.order.cancelled');
    event.payload = { ...event.payload, refundAmount: 0 };
    await router.route(event);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ body: 'Đơn TF-ABC123 đã huỷ' }));
  });

  it('unique source_event_id trả null thì không phát realtime lần nữa', async () => {
    const { router, insert, emitToUser } = setup();
    insert.mockResolvedValue(null);
    expect(await router.route(createEvent('commerce.order.cancelled'))).toBe('handled');
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('realtime ném lỗi vẫn xử lý xong và đánh dấu sự kiện', async () => {
    const { router, emitToUser, processed, log } = setup();
    emitToUser.mockImplementation(() => {
      throw new Error('Socket lỗi');
    });
    const event = createEvent();
    expect(await router.route(event)).toBe('handled');
    expect(await processed.has(event.eventId)).toBe(true);
    expect(log).toHaveBeenCalledWith('Không phát được thông báo realtime', event);
  });

  it('inbox lỗi thì không đánh dấu, giao lại thành công mới đánh dấu', async () => {
    const { router, insert, processed } = setup();
    const event = createEvent('commerce.order.cancelled');
    insert.mockRejectedValueOnce(new Error('DB lỗi'));
    await expect(router.route(event)).rejects.toThrow('DB lỗi');
    expect(await processed.has(event.eventId)).toBe(false);
    expect(await router.route(event)).toBe('handled');
    expect(await processed.has(event.eventId)).toBe(true);
  });

  it('chưa đánh dấu processed trong khi ghi inbox', async () => {
    const { router, insert, processed } = setup();
    const event = createEvent('commerce.order.cancelled');
    insert.mockImplementationOnce(async () => {
      expect(await processed.has(event.eventId)).toBe(false);
      return null;
    });
    await router.route(event);
    expect(await processed.has(event.eventId)).toBe(true);
  });
});
