import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { MemoryMailer } from '../outapp/mailer.js';
import { buildPasswordResetEmail } from '../outapp/password-reset.email.js';
import { buildWelcomeEmail } from '../outapp/welcome.email.js';
import { EventRouter, MemoryProcessedEvents } from './event-router.js';

const resetPayload = () => ({
  userId: randomUUID(),
  email: 'khang@example.com',
  displayName: 'Khang <script>',
  resetUrl: 'http://localhost:3100/dat-lai-mat-khau?token=abc',
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});

function createEvent(type: string, payload: Record<string, unknown>): EventEnvelope {
  return {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api/access',
    userId: null,
    payload,
  };
}

describe('buildPasswordResetEmail', () => {
  it('gửi tới đúng email, có link, tiêu đề tiếng Việt, chống chèn HTML', () => {
    const mail = buildPasswordResetEmail(resetPayload());
    expect(mail.to).toBe('khang@example.com');
    expect(mail.subject).toBe('Đặt lại mật khẩu Tripflix');
    expect(mail.text).toContain('http://localhost:3100/dat-lai-mat-khau?token=abc');
    expect(mail.text).toMatch(/30 phút/);
    expect(mail.html).toContain('Khang &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
  });
});

const welcomePayload = (provider: 'password' | 'google') => ({
  userId: randomUUID(),
  email: 'an@example.com',
  displayName: 'An <b>',
  provider,
});

describe('buildWelcomeEmail', () => {
  it('gửi tới đúng email, tiêu đề tiếng Việt, có nút mở web, chống chèn HTML', () => {
    const mail = buildWelcomeEmail(welcomePayload('password'), 'https://tripflix.vn');
    expect(mail.to).toBe('an@example.com');
    expect(mail.subject).toBe('Chào mừng bạn đến với Tripflix');
    expect(mail.text).toContain('https://tripflix.vn');
    expect(mail.html).toContain('href="https://tripflix.vn"');
    expect(mail.html).toContain('An &lt;b&gt;');
    expect(mail.html).not.toContain('An <b>');
    expect(mail.text).toContain('email an@example.com và mật khẩu');
  });

  it('đăng ký bằng Google: nói rõ đăng nhập bằng Google và cách tạo mật khẩu', () => {
    const mail = buildWelcomeEmail(welcomePayload('google'), 'http://localhost:3100');
    expect(mail.text).toContain('tạo tài khoản Tripflix bằng Google');
    expect(mail.text).toContain('Quên mật khẩu');
  });
});

describe('EventRouter', () => {
  const log = vi.fn();

  it('access.user.welcome_email_requested thì gửi email chào mừng với link WEB_APP_URL, giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log, {
      webAppUrl: 'https://tripflix.vn',
    });
    const event = createEvent('access.user.welcome_email_requested', welcomePayload('google'));
    expect(await router.route(event)).toBe('handled');
    expect(await router.route(event)).toBe('duplicate');
    expect(mailer.sent.map((m) => m.subject)).toEqual(['Chào mừng bạn đến với Tripflix']);
    expect(mailer.sent[0]?.text).toContain('https://tripflix.vn');
  });

  it('access.registration_attempted_existing thì gửi email báo đã có tài khoản, giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log, {
      webAppUrl: 'https://tripflix.vn',
    });
    const event = createEvent('access.registration_attempted_existing', {
      userId: randomUUID(),
      email: 'binh@example.com',
      displayName: 'Bình',
      hasPassword: true,
    });
    expect(await router.route(event)).toBe('handled');
    expect(await router.route(event)).toBe('duplicate');
    expect(mailer.sent.map((m) => m.subject)).toEqual(['Email này đã có tài khoản Tripflix']);
    expect(mailer.sent[0]?.to).toBe('binh@example.com');
  });

  it('access.password_reset_requested thì gửi email, sự kiện giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const event = createEvent('access.password_reset_requested', resetPayload());
    expect(await router.route(event)).toBe('handled');
    expect(await router.route(event)).toBe('duplicate');
    expect(mailer.sent).toHaveLength(1);
  });

  const paidPayload = (contactEmail: string | null) => ({
    orderId: randomUUID(),
    userId: randomUUID(),
    total: 2_850_000,
    sourcePostId: null,
    items: [
      { productType: 'room', productId: 'P-1', date: '2026-12-01', nights: 2, qty: 1 },
      { productType: 'flight', productId: 'F-1', date: '2026-12-03', nights: 1, qty: 3 },
    ],
    confirmationCode: 'TF-ABC123',
    contactName: 'An <b>',
    contactEmail,
  });

  it('commerce.order.paid thì gửi email xác nhận đúng nội dung, giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const event = createEvent('commerce.order.paid', paidPayload('an@example.com'));
    await expect(router.route(event)).resolves.toBe('handled');
    await expect(router.route(event)).resolves.toBe('duplicate');
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe('an@example.com');
    expect(mail.subject).toContain('TF-ABC123');
    expect(mail.text).toContain('2.850.000đ');
    expect(mail.text).toContain('nhận phòng 01/12/2026 · 2 đêm · 1 phòng');
    expect(mail.text).toContain('ngày bay 03/12/2026 · 3 ghế');
    expect(mail.html).toContain('An &lt;b&gt;');
    expect(mail.html).not.toContain('An <b>');
  });

  it('email xác nhận có link mở lại đơn trên web', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log, {
      webAppUrl: 'https://tripflix.io.vn/',
    });
    const payload = paidPayload('an@example.com');
    await router.route(createEvent('commerce.order.paid', payload));
    const orderUrl = `https://tripflix.io.vn/checkout/${payload.orderId}`;
    expect(mailer.sent[0]!.text).toContain(`Xem đơn: ${orderUrl}`);
    expect(mailer.sent[0]!.html).toContain(`href="${orderUrl}"`);
  });

  it('email xác nhận hiện tên khách sạn, chuyến bay, giờ bay và hành khách khi sự kiện có đủ', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const payload = paidPayload('an@example.com');
    await router.route(
      createEvent('commerce.order.paid', {
        ...payload,
        items: [
          {
            ...payload.items[0],
            productName: 'Deluxe',
            propertyName: 'Khách sạn <Biển>',
            ratePlanName: 'Gồm ăn sáng',
            flight: null,
          },
          {
            ...payload.items[1],
            productName: 'VN123 · Phổ thông',
            propertyName: null,
            ratePlanName: 'Tiết kiệm',
            flight: { fromAirport: 'SGN', toAirport: 'CXR', departTime: '07:05:00', arriveTime: '08:15:00' },
          },
        ],
        guests: [
          { fullName: 'Người Lớn', passengerType: 'adult' },
          { fullName: 'Bé Na', passengerType: 'infant' },
        ],
      }),
    );
    const mail = mailer.sent[0]!;
    expect(mail.text).toContain(
      'Khách sạn <Biển> · Deluxe · Gồm ăn sáng · nhận phòng 01/12/2026 · trả phòng 03/12/2026 · 2 đêm · 1 phòng',
    );
    expect(mail.text).toContain(
      'VN123 · Phổ thông · Tiết kiệm · SGN → CXR · 03/12/2026 · 07:05–08:15 · 3 ghế',
    );
    expect(mail.text).toContain('- Người Lớn (Người lớn)');
    expect(mail.text).toContain('- Bé Na (Em bé)');
    expect(mail.html).toContain('Khách sạn &lt;Biển&gt;');
  });

  it('commerce.order.paid không có email liên hệ thì không gửi, vẫn đánh dấu đã xử lý', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const event = createEvent('commerce.order.paid', paidPayload(null));
    await expect(router.route(event)).resolves.toBe('ignored');
    await expect(router.route(event)).resolves.toBe('duplicate');
    expect(mailer.sent).toHaveLength(0);
  });

  it('sự kiện chưa có việc thì chỉ ghi log đã nhận', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    expect(
      await router.route(createEvent('access.user.registered', { userId: randomUUID(), displayName: 'A' })),
    ).toBe('ignored');
    expect(mailer.sent).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      'Đã nhận sự kiện',
      expect.objectContaining({ type: 'access.user.registered' }),
    );
  });

  it('gửi email lỗi thì ném lỗi và không đánh dấu đã xử lý (để giao lại)', async () => {
    const processed = new MemoryProcessedEvents();
    const router = new EventRouter(
      { send: async () => Promise.reject(new Error('SMTP lỗi')) },
      processed,
      log,
    );
    const event = createEvent('access.password_reset_requested', resetPayload());
    await expect(router.route(event)).rejects.toThrow('SMTP lỗi');
    expect(await processed.has(event.eventId)).toBe(false);
  });

  it('payload sai hợp đồng thì ném lỗi', async () => {
    const router = new EventRouter(new MemoryMailer(), new MemoryProcessedEvents(), log);
    await expect(
      router.route(createEvent('access.password_reset_requested', { email: 'x' })),
    ).rejects.toThrow();
  });
});
