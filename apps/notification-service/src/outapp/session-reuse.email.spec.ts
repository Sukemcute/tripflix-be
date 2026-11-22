import { randomUUID } from 'node:crypto';
import { buildSessionReuseEmail } from './session-reuse.email.js';

describe('buildSessionReuseEmail', () => {
  it('báo phiên bị đăng xuất, nêu thiết bị, có link đăng nhập lại và đặt lại mật khẩu, chống chèn HTML', () => {
    const mail = buildSessionReuseEmail(
      { userId: randomUUID(), email: 'binh@example.com', displayName: 'Bình', deviceName: 'iPhone <b>' },
      'https://tripflix.vn/',
    );
    expect(mail.to).toBe('binh@example.com');
    expect(mail.text).toContain('iPhone <b>');
    expect(mail.text).toContain('https://tripflix.vn/login');
    expect(mail.text).toContain('https://tripflix.vn/forgot-password');
    expect(mail.html).toContain('iPhone &lt;b&gt;');
    expect(mail.html).not.toContain('<b>');
  });

  it('không có tên thiết bị vẫn đọc tự nhiên', () => {
    const mail = buildSessionReuseEmail(
      { userId: randomUUID(), email: 'binh@example.com', displayName: 'Bình', deviceName: null },
      'http://localhost:3100',
    );
    expect(mail.text).toContain('trên một thiết bị');
    expect(mail.text).not.toContain('null');
  });
});
