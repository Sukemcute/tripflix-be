import { randomUUID } from 'node:crypto';
import {
  CommerceOrderPaidV1Schema,
  DiscoverySearchPerformedV1Schema,
  DiscoveryStaysSearchedV1Schema,
  eventEnvelopeSchema,
} from './index.js';

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

describe('TF28: sự kiện tìm kiếm của discovery', () => {
  const envelopeType = eventEnvelopeSchema.shape.type;
  const search = {
    userId: randomUUID(),
    surface: 'explore',
    placeIds: ['da-lat'],
    intent: 'stay',
    budgetMax: 2_000_000,
    postType: null,
    resultCount: 12,
  };
  const stays = {
    userId: randomUUID(),
    placeId: 'da-lat',
    checkIn: '2026-12-01',
    checkOut: '2026-12-03',
    adults: 2,
    rooms: 1,
    minStars: null,
    priceMax: null,
    resultCount: 5,
  };

  it('tên loại sự kiện khớp regex phong bì', () => {
    expect(envelopeType.safeParse('discovery.search.performed').success).toBe(true);
    expect(envelopeType.safeParse('discovery.stays.searched').success).toBe(true);
  });

  it('nhận payload mẫu', () => {
    expect(DiscoverySearchPerformedV1Schema.safeParse(search).success).toBe(true);
    expect(DiscoverySearchPerformedV1Schema.safeParse({ ...search, surface: 'posts', postType: 'review', placeIds: [] }).success).toBe(true);
    expect(DiscoveryStaysSearchedV1Schema.safeParse(stays).success).toBe(true);
  });

  it('từ chối khi thiếu userId', () => {
    const { userId: _s, ...searchNoUser } = search;
    const { userId: _t, ...staysNoUser } = stays;
    expect(DiscoverySearchPerformedV1Schema.safeParse(searchNoUser).success).toBe(false);
    expect(DiscoveryStaysSearchedV1Schema.safeParse(staysNoUser).success).toBe(false);
  });

  it('không giữ nguyên câu tìm q sau khi parse', () => {
    expect(DiscoverySearchPerformedV1Schema.parse({ ...search, q: 'khách sạn gần chợ Đà Lạt' })).not.toHaveProperty('q');
  });

  it('từ chối ngày sai định dạng và quá 10 nơi', () => {
    expect(DiscoveryStaysSearchedV1Schema.safeParse({ ...stays, checkIn: '01/12/2026' }).success).toBe(false);
    expect(DiscoverySearchPerformedV1Schema.safeParse({ ...search, placeIds: Array(11).fill('x') }).success).toBe(false);
  });
});
