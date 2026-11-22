import { randomUUID } from 'node:crypto';
import {
  CommerceOrderPaidV1Schema,
  ContentCommentCreatedV1Schema,
  ContentCommentDeletedV1Schema,
  ContentCommentHiddenV1Schema,
  ContentCommentRestoredV1Schema,
  ContentCommentUpdatedV1Schema,
  ContentPostBookingClickedV1Schema,
  ContentPostViewedV1Schema,
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

describe('TF99: postVisibility trong sự kiện bình luận', () => {
  const ids = { commentId: randomUUID(), postId: randomUUID(), authorId: randomUUID() };
  const now = new Date().toISOString();
  const cases = [
    [ContentCommentCreatedV1Schema, { ...ids, postAuthorId: randomUUID(), parentCommentId: null, body: 'Đẹp quá', createdAt: now }],
    [ContentCommentUpdatedV1Schema, { ...ids, parentCommentId: null, body: 'Đẹp quá', updatedAt: now }],
    [ContentCommentDeletedV1Schema, { ...ids, parentCommentId: null, deletedBy: ids.authorId, isSuperAdmin: false, deletedAt: now }],
    [ContentCommentHiddenV1Schema, ids],
    [ContentCommentRestoredV1Schema, ids],
  ] as const;

  it.each(cases)('nhận sự kiện cũ không có postVisibility, giữ giá trị public/private', (schema, payload) => {
    expect(schema.parse(payload)).not.toHaveProperty('postVisibility');
    expect(schema.parse({ ...payload, postVisibility: 'public' })).toMatchObject({ postVisibility: 'public' });
    expect(schema.parse({ ...payload, postVisibility: 'private' })).toMatchObject({ postVisibility: 'private' });
  });

  it.each(cases)('từ chối giá trị postVisibility lạ', (schema, payload) => {
    expect(schema.safeParse({ ...payload, postVisibility: 'friends' }).success).toBe(false);
  });
});

describe('TF23: sự kiện xem và bấm đặt từ Reels', () => {
  const postId = randomUUID();
  const view = {
    postId,
    viewerId: null,
    anonId: randomUUID(),
    watchedMs: 20_000,
    durationSec: 43,
    isQualified: true,
    surface: 'reels',
  };

  it('tên loại sự kiện khớp regex phong bì', () => {
    const type = eventEnvelopeSchema.shape.type;
    expect(type.safeParse('content.post.viewed').success).toBe(true);
    expect(type.safeParse('content.post.booking_clicked').success).toBe(true);
  });

  it('nhận lượt xem của khách, chưa biết thời lượng', () => {
    expect(ContentPostViewedV1Schema.safeParse(view).success).toBe(true);
    expect(ContentPostViewedV1Schema.safeParse({ ...view, anonId: null, durationSec: null }).success).toBe(true);
  });

  it('từ chối thời gian xem âm, quá 10 phút, hoặc nơi xem lạ', () => {
    expect(ContentPostViewedV1Schema.safeParse({ ...view, watchedMs: -1 }).success).toBe(false);
    expect(ContentPostViewedV1Schema.safeParse({ ...view, watchedMs: 600_001 }).success).toBe(false);
    expect(ContentPostViewedV1Schema.safeParse({ ...view, surface: 'home' }).success).toBe(false);
  });

  it('bấm đặt nhận mã khách sạn dạng chuỗi hoặc null', () => {
    const click = { postId, viewerId: randomUUID(), anonId: null, hotelId: 'P-osm-vinh-long-040', surface: 'reels_trip_plan' };
    expect(ContentPostBookingClickedV1Schema.safeParse(click).success).toBe(true);
    expect(ContentPostBookingClickedV1Schema.safeParse({ ...click, hotelId: null }).success).toBe(true);
    expect(ContentPostBookingClickedV1Schema.safeParse({ ...click, hotelId: '' }).success).toBe(false);
  });
});

describe('TF25: mentionedUserIds trong content.comment.created', () => {
  const base = {
    commentId: randomUUID(),
    postId: randomUUID(),
    postAuthorId: randomUUID(),
    authorId: randomUUID(),
    parentCommentId: null,
    body: '@Trang đẹp quá',
    createdAt: new Date().toISOString(),
  };

  it('nhận sự kiện cũ không có tag và danh sách UUID không trùng tối đa 10', () => {
    expect(ContentCommentCreatedV1Schema.parse(base)).not.toHaveProperty('mentionedUserIds');
    const ids = Array.from({ length: 10 }, () => randomUUID());
    expect(ContentCommentCreatedV1Schema.parse({ ...base, mentionedUserIds: ids }).mentionedUserIds).toEqual(ids);
  });

  it('từ chối id trùng, không phải UUID hoặc quá 10 người', () => {
    const id = randomUUID();
    for (const mentionedUserIds of [[id, id], ['x'], Array.from({ length: 11 }, () => randomUUID())]) {
      expect(ContentCommentCreatedV1Schema.safeParse({ ...base, mentionedUserIds }).success).toBe(false);
    }
  });
});
