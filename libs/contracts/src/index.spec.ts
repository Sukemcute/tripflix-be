import { randomUUID } from 'node:crypto';
import { eventEnvelopeSchema } from './index.js';

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
