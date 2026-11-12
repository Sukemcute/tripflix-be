import type { EventEnvelope } from '@tripflix/contracts';
import { toOrderCancellation, toRawRows } from './to-raw-rows.js';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const O = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const AT = '2026-11-12T10:00:00.000Z';

const event = (type: string, payload: unknown, version = 1) =>
  ({ eventId: E, type, version, occurredAt: AT, producer: 'core-api', payload }) as EventEnvelope;

describe('toRawRows', () => {
  it('cảm xúc: ghi đè theo postId; gỡ (type null) → isRemoved', () => {
    const [set] = toRawRows(event('content.reaction.updated', { postId: P, userId: U, type: 'love', reactionTotal: 1, reactionCounts: {} }))!;
    expect(set).toEqual({
      actorType: 'user', actorId: U, kind: 'reaction', refId: P, targetType: 'post', targetId: P,
      value: null, isRemoved: false, detail: { type: 'love' }, occurredAt: AT,
    });
    const [removed] = toRawRows(event('content.reaction.updated', { postId: P, userId: U, type: null, reactionTotal: 0, reactionCounts: {} }))!;
    expect(removed).toMatchObject({ refId: P, isRemoved: true });
  });

  it('bỏ thích bình luận → isRemoved, detail.postId', () => {
    const rows = toRawRows(event('content.comment_reaction.updated', { commentId: C, postId: P, commentAuthorId: U, userId: U, isLiked: false, likeCount: 0 }));
    expect(rows).toEqual([expect.objectContaining({ kind: 'comment_reaction', refId: C, targetType: 'comment', isRemoved: true, detail: { postId: P } })]);
  });

  it('chia sẻ: mỗi lần một dòng (ref eventId); không có user thì bỏ', () => {
    expect(toRawRows(event('content.post.shared', { postId: P, userId: U, shareUrl: 'x' }))).toEqual([
      expect.objectContaining({ kind: 'share', refId: E, targetId: P }),
    ]);
    expect(toRawRows(event('content.post.shared', { postId: P, userId: null, shareUrl: 'x' }))).toEqual([]);
  });

  it('bình luận: không lưu body; xoá → isRemoved', () => {
    const base = { commentId: C, postId: P, authorId: U, parentCommentId: null };
    const [created] = toRawRows(event('content.comment.created', { ...base, postAuthorId: U, body: 'bí mật', createdAt: AT }))!;
    expect(JSON.stringify(created)).not.toContain('bí mật');
    expect(created).toMatchObject({ kind: 'comment', refId: C, targetId: P, isRemoved: false });
    const [deleted] = toRawRows(event('content.comment.deleted', { ...base, deletedBy: U, isSuperAdmin: false, deletedAt: AT }))!;
    expect(deleted).toMatchObject({ refId: C, isRemoved: true });
  });

  it('đơn đã trả: mỗi mục một dòng orderId:index, không lưu liên hệ/khách', () => {
    const rows = toRawRows(
      event('commerce.order.paid', {
        orderId: O, userId: U, total: 100, sourcePostId: P, contactName: 'Nguyễn A', contactEmail: 'a@x.vn', contactPhone: '090',
        guests: [{ fullName: 'Nguyễn A', passengerType: 'adult' }],
        items: [
          { productType: 'room', productId: 'H1', date: '2026-12-01', nights: 2, qty: 1, productName: 'Phòng' },
          { productType: 'flight', productId: 'F1', date: '2026-12-01', nights: 1, qty: 2, flight: { fromAirport: 'SGN', toAirport: 'DLI', departTime: null, arriveTime: null } },
        ],
      }),
    )!;
    expect(rows.map((r) => r.refId)).toEqual([`${O}:0`, `${O}:1`]);
    expect(rows[1]).toMatchObject({ kind: 'order_item', targetType: 'flight', targetId: 'F1', detail: { sourcePostId: P, qty: 2, flight: { fromAirport: 'SGN', toAirport: 'DLI' } } });
    expect(JSON.stringify(rows)).not.toMatch(/Nguyễn|a@x\.vn|090/);
  });

  it('tìm kiếm: target = nơi đầu tiên; không có nơi thì null', () => {
    const payload = { userId: U, surface: 'explore', placeIds: ['da-lat', 'hue'], intent: 'food', budgetMax: null, postType: null, resultCount: 3 };
    expect(toRawRows(event('discovery.search.performed', payload))).toEqual([
      expect.objectContaining({ kind: 'search', refId: E, targetType: 'place', targetId: 'da-lat', detail: { placeIds: ['da-lat', 'hue'], intent: 'food', budgetMax: null, surface: 'explore', postType: null } }),
    ]);
    expect(toRawRows(event('discovery.search.performed', { ...payload, placeIds: [] }))![0]).toMatchObject({ targetType: null, targetId: null });
  });

  it('tài khoản: registered / guest_merged / locked', () => {
    expect(toRawRows(event('access.user.registered', { userId: U, displayName: 'A' }))![0]).toMatchObject({ kind: 'registered', refId: U });
    expect(toRawRows(event('access.user.guest_merged', { userId: U, anonId: C }))![0]).toMatchObject({ kind: 'guest_merged', refId: C });
    expect(toRawRows(event('access.user.locked', { userId: U, lockedBy: C }))![0]).toMatchObject({ kind: 'locked', refId: U });
  });

  it('payload hỏng → null; loại lạ hoặc version khác → []', () => {
    expect(toRawRows(event('content.reaction.updated', { postId: 'không-phải-uuid', userId: U, type: 'like' }))).toBeNull();
    expect(toRawRows(event('content.post.moderated', { postId: P }))).toEqual([]);
    expect(toRawRows(event('content.reaction.updated', { postId: P, userId: U, type: 'like' }, 2))).toEqual([]);
  });
});

describe('toOrderCancellation', () => {
  it('huỷ đơn → userId + orderId; hỏng → null; sự kiện khác → undefined', () => {
    const payload = { orderId: O, userId: U, total: 1, refundAmount: 0, feeAmount: 0, confirmationCode: null, contactName: null, contactEmail: null };
    expect(toOrderCancellation(event('commerce.order.cancelled', payload))).toEqual({ userId: U, orderId: O, occurredAt: AT });
    expect(toOrderCancellation(event('commerce.order.cancelled', { orderId: O }))).toBeNull();
    expect(toOrderCancellation(event('commerce.order.paid', payload))).toBeUndefined();
  });
});
