import type { ContentPostBookingClickedV1, ContentPostViewedV1 } from '@tripflix/contracts';
import { actorKeyOf, toBookingClickSignal, toViewSignal } from './trend-signal.js';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ANON_ID = '33333333-3333-4333-8333-333333333333';
const AT = '2026-11-19T02:00:00.000Z';

const view = (over: Partial<ContentPostViewedV1> = {}): ContentPostViewedV1 => ({
  postId: POST_ID,
  viewerId: USER_ID,
  anonId: null,
  watchedMs: 20_000,
  durationSec: 40,
  isQualified: true,
  surface: 'reels',
  ...over,
});

const click = (over: Partial<ContentPostBookingClickedV1> = {}): ContentPostBookingClickedV1 => ({
  postId: POST_ID,
  viewerId: USER_ID,
  anonId: null,
  hotelId: 'hotel_1',
  surface: 'reels_trip_plan',
  ...over,
});

describe('actorKeyOf', () => {
  it('ưu tiên tài khoản khi có cả viewerId và anonId', () => {
    expect(actorKeyOf({ viewerId: USER_ID, anonId: ANON_ID })).toEqual({
      actorKey: `u:${USER_ID}`,
      isGuest: false,
    });
  });

  it('khách dùng anonId; không có cả hai thì không biết là ai', () => {
    expect(actorKeyOf({ viewerId: null, anonId: ANON_ID })).toEqual({
      actorKey: `a:${ANON_ID}`,
      isGuest: true,
    });
    expect(actorKeyOf({ viewerId: null, anonId: null })).toBeNull();
  });
});

describe('toViewSignal', () => {
  it('lượt xem đủ thành tín hiệu view', () => {
    expect(toViewSignal(view(), AT)).toEqual({
      postId: POST_ID,
      kind: 'view',
      actorKey: `u:${USER_ID}`,
      isGuest: false,
      occurredAt: AT,
    });
  });

  it('lượt xem của khách vẫn tính, đánh dấu isGuest', () => {
    expect(toViewSignal(view({ viewerId: null, anonId: ANON_ID }), AT)).toMatchObject({
      isGuest: true,
      actorKey: `a:${ANON_ID}`,
    });
  });

  it('bỏ lượt xem chưa đủ và lượt xem không rõ người xem', () => {
    expect(toViewSignal(view({ isQualified: false }), AT)).toBeNull();
    expect(toViewSignal(view({ viewerId: null, anonId: null }), AT)).toBeNull();
  });
});

describe('toBookingClickSignal', () => {
  it('người đăng nhập bấm đặt thành tín hiệu booking_click, kể cả lộ trình không có khách sạn', () => {
    expect(toBookingClickSignal(click({ hotelId: null }), AT)).toMatchObject({
      kind: 'booking_click',
      actorKey: `u:${USER_ID}`,
    });
  });

  it('bỏ lượt bấm của khách và lượt không rõ người bấm', () => {
    expect(toBookingClickSignal(click({ viewerId: null, anonId: ANON_ID }), AT)).toBeNull();
    expect(toBookingClickSignal(click({ viewerId: null }), AT)).toBeNull();
  });
});
