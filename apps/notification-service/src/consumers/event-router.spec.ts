import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { MemoryMailer } from '../outapp/mailer.js';
import { buildPasswordResetEmail } from '../outapp/password-reset.email.js';
import { EventRouter, MemoryProcessedEvents } from './event-router.js';

const resetPayload = () => ({
  userId: randomUUID(),
  email: 'khang@example.com',
  displayName: 'Khang <script>',
  resetUrl: 'http://localhost:3100/dat-lai-mat-khau?token=abc',
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});

function createEvent(type: string, payload: Record<string, unknown>): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), producer: 'core-api/access', userId: null, payload };
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

describe('EventRouter', () => {
  const log = vi.fn();

  it('access.password_reset_requested thì gửi email, sự kiện giao lại không gửi lần hai', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    const event = createEvent('access.password_reset_requested', resetPayload());
    expect(await router.route(event)).toBe('handled');
    expect(await router.route(event)).toBe('duplicate');
    expect(mailer.sent).toHaveLength(1);
  });

  it('sự kiện chưa có việc thì chỉ ghi log đã nhận', async () => {
    const mailer = new MemoryMailer();
    const router = new EventRouter(mailer, new MemoryProcessedEvents(), log);
    expect(await router.route(createEvent('access.user.registered', { userId: randomUUID(), displayName: 'A' }))).toBe('ignored');
    expect(mailer.sent).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('Đã nhận sự kiện', expect.objectContaining({ type: 'access.user.registered' }));
  });

  it('gửi email lỗi thì ném lỗi và không đánh dấu đã xử lý (để giao lại)', async () => {
    const processed = new MemoryProcessedEvents();
    const router = new EventRouter({ send: async () => Promise.reject(new Error('SMTP lỗi')) }, processed, log);
    const event = createEvent('access.password_reset_requested', resetPayload());
    await expect(router.route(event)).rejects.toThrow('SMTP lỗi');
    expect(await processed.has(event.eventId)).toBe(false);
  });

  it('payload sai hợp đồng thì ném lỗi', async () => {
    const router = new EventRouter(new MemoryMailer(), new MemoryProcessedEvents(), log);
    await expect(router.route(createEvent('access.password_reset_requested', { email: 'x' }))).rejects.toThrow();
  });
});
