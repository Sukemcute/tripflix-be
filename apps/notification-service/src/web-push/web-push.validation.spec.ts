import {
  SubscriptionSchema,
  isPushEndpoint,
  webNotificationHref,
  webPushData,
} from './web-push.validation.js';
import { envSchema } from '../env.js';

describe('Web Push validation', () => {
  it('không gửi dữ liệu riêng hoặc danh sách actor không giới hạn qua push', () => {
    expect(
      webPushData({
        postId: 'p',
        email: 'private@example.test',
        token: 'private',
        actorIds: Array(1000).fill('a'),
        orderId: 'x'.repeat(129),
      }),
    ).toEqual({ postId: 'p', actorIds: ['a'] });
    expect(
      webNotificationHref({ type: 'x', link: '/' + 'x'.repeat(3000), data: {} }, 'https://tripflix.test'),
    ).toBe('/');
  });

  it.each([
    'http://fcm.googleapis.com/a',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://user:pass@fcm.googleapis.com/a',
    'https://fcm.googleapis.com:8443/a',
    'https://evil.test/a',
  ])('từ chối endpoint SSRF: %s', (endpoint) => expect(isPushEndpoint(endpoint)).toBe(false));
  it.each([
    'https://fcm.googleapis.com/fcm/send/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/x',
  ])('chấp nhận dịch vụ push: %s', (endpoint) => expect(isPushEndpoint(endpoint)).toBe(true));
  it('từ chối key sai và field không thuộc hợp đồng', () => {
    expect(
      SubscriptionSchema.safeParse({
        endpoint: 'https://fcm.googleapis.com/a',
        keys: { p256dh: 'abc', auth: 'abc' },
      }).success,
    ).toBe(false);
  });
  it('link bình luận mở đúng bài và comment; URL ngoài origin không được mở', () => {
    expect(
      webNotificationHref(
        { type: 'comment.replied', link: null, data: { postId: 'p', commentId: 'c' } },
        'https://tripflix.test',
      ),
    ).toBe('/inspiration?open=p&comment=c');
    expect(
      webNotificationHref({ type: 'x', link: 'javascript:alert(1)', data: {} }, 'https://tripflix.test'),
    ).toBe('/');
    expect(webNotificationHref({ type: 'x', link: '//evil.test', data: {} }, 'https://tripflix.test')).toBe(
      '/',
    );
  });
  it('bật push thiếu VAPID phải báo lỗi khi khởi động', () => {
    expect(envSchema.safeParse({ DATABASE_URL_NOTIFICATION: 'test', WEB_PUSH_ENABLED: 'true' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ DATABASE_URL_NOTIFICATION: 'test' }).success).toBe(true);
  });
});
