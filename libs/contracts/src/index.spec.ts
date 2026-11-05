import { randomUUID } from 'node:crypto';
import { CommerceOrderPaidV1Schema, eventEnvelopeSchema } from './index.js';

describe('eventEnvelopeSchema', () => {
  const valid = {
    eventId: randomUUID(),
    type: 'commerce.order.paid',
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api',
    payload: { orderId: 'o1' },
  };

  it('nhận sự kiện đúng định dạng', () => {
    expect(eventEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it('từ chối type sai định dạng', () => {
    expect(eventEnvelopeSchema.safeParse({ ...valid, type: 'OrderPaid' }).success).toBe(false);
  });
});

describe('CommerceOrderPaidV1Schema', () => {
  const base = { orderId: randomUUID(), userId: randomUUID(), total: 1_000_000, sourcePostId: null, items: [{ productType: 'room', productId: 'R1', date: '2026-12-01', nights: 2, qty: 1 }] };

  it('nhận sự kiện cũ chưa có thông tin liên hệ', () => {
    expect(CommerceOrderPaidV1Schema.safeParse(base).success).toBe(true);
  });

  it('nhận thông tin liên hệ, email có thể null', () => {
    const withContact = { ...base, confirmationCode: 'TF-ABC234', contactName: 'Khách Thử', contactEmail: 'khach@example.com' };
    expect(CommerceOrderPaidV1Schema.parse(withContact)).toMatchObject({ contactEmail: 'khach@example.com', contactName: 'Khách Thử' });
    expect(CommerceOrderPaidV1Schema.safeParse({ ...withContact, contactEmail: null }).success).toBe(true);
  });
});
