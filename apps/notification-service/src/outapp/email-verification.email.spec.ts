import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { EventRouter, MemoryProcessedEvents } from '../consumers/event-router.js';
import { buildEmailVerificationEmail } from './email-verification.email.js';
import { MemoryMailer } from './mailer.js';

const payload = (reason: 'signup' | 'resend') => ({
  userId: randomUUID(),
  email: 'lan@example.com',
  displayName: 'Lan <img src=x onerror=alert(1)>',
  verifyUrl: 'https://tripflix.io.vn/xac-thuc-email?token=abc_DEF-123&x="1"',
  expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  reason,
});

describe('TF05D: buildEmailVerificationEmail', () => {
  it('đăng ký: gộp lời chào mừng và nút xác nhận, gửi đúng người, link nguyên vẹn trong bản chữ', () => {
    const mail = buildEmailVerificationEmail(payload('signup'));
    expect(mail.to).toBe('lan@example.com');
    expect(mail.subject).toBe('Chào mừng bạn đến với Tripflix, hãy xác nhận email');
    expect(mail.text).toContain('Cảm ơn bạn đã tạo tài khoản Tripflix');
    expect(mail.text).toContain('https://tripflix.io.vn/xac-thuc-email?token=abc_DEF-123&x="1"');
    expect(mail.text).toMatch(/24 giờ/);
    expect(mail.html).toContain('Xác nhận email</a>');
    expect(mail.html).toContain('Lưu chuyến đi');
  });

  it('gửi lại: không có lời chào mừng, tiêu đề riêng', () => {
    const mail = buildEmailVerificationEmail(payload('resend'));
    expect(mail.subject).toBe('Xác nhận email Tripflix của bạn');
    expect(mail.text).not.toContain('Cảm ơn bạn đã tạo tài khoản');
    expect(mail.html).not.toContain('Lưu chuyến đi');
    expect(mail.text).toContain('Nếu không phải bạn yêu cầu');
  });

  it('chống chèn HTML: tên và link đều được thoát ký tự trong bản HTML', () => {
    const mail = buildEmailVerificationEmail(payload('signup'));
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('Lan &lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).toContain(
      'href="https://tripflix.io.vn/xac-thuc-email?token=abc_DEF-123&amp;x=&quot;1&quot;"',
    );
  });

  it('link sắp hết hạn vẫn ghi ít nhất 1 giờ', () => {
    const mail = buildEmailVerificationEmail({
      ...payload('resend'),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(mail.text).toMatch(/1 giờ/);
  });
});

describe('TF05D: EventRouter với access.email_verification_requested', () => {
  const log = () => undefined;
  const event = (data: Record<string, unknown>): EventEnvelope => ({
    eventId: randomUUID(),
    type: 'access.email_verification_requested',
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'core-api/access',
    userId: null,
    payload: data,
  });

  it('gửi đúng một email, giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const e = event(payload('signup'));
    expect(await router.route(e)).toBe('handled');
    expect(await router.route(e)).toBe('duplicate');
    expect(mailer.sent.map((m) => m.to)).toEqual(['lan@example.com']);
  });

  it('payload sai hợp đồng (thiếu verifyUrl, reason lạ) thì ném lỗi, không gửi', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const { verifyUrl: _omit, ...missing } = payload('signup');
    await expect(router.route(event(missing))).rejects.toThrow();
    await expect(router.route(event({ ...payload('signup'), reason: 'spam' }))).rejects.toThrow();
    expect(mailer.sent).toHaveLength(0);
  });
});
