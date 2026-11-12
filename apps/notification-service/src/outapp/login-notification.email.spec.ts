import { describe, expect, it } from 'vitest';
import { buildLoginNotificationEmail } from './login-notification.email.js';

describe('buildLoginNotificationEmail', () => {
  it('tạo email thông báo đăng nhập đẹp, đầy đủ thông tin, thoát ký tự nguy hiểm', () => {
    const mail = buildLoginNotificationEmail(
      {
        email: 'dung@example.com',
        displayName: 'Đức Dũng <script>',
        deviceName: 'MacBook Pro M3 <img src=x>',
        ipAddress: '14.161.22.10',
        location: 'TP. Hồ Chí Minh',
        loginAt: '2026-11-12T14:30:00Z',
      },
      'https://tripflix.vn',
    );

    expect(mail.to).toBe('dung@example.com');
    expect(mail.subject).toBe('Thông báo đăng nhập tài khoản Tripflix');
    expect(mail.text).toContain('Đức Dũng <script>');
    expect(mail.text).toContain('MacBook Pro M3 <img src=x>');
    expect(mail.text).toContain('14.161.22.10');
    expect(mail.text).toContain('TP. Hồ Chí Minh');
    expect(mail.text).toContain('https://tripflix.vn/account');
    expect(mail.text).toContain('https://tripflix.vn/forgot-password');

    expect(mail.html).toContain('Đức Dũng &lt;script&gt;');
    expect(mail.html).toContain('MacBook Pro M3 &lt;img src=x&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x>');
    expect(mail.html).toContain('Tripflix');
    expect(mail.html).toContain('Quản lý phiên đăng nhập');
  });

  it('xử lý khi không có deviceName, IP hay location', () => {
    const mail = buildLoginNotificationEmail(
      {
        email: 'user@example.com',
        displayName: 'Người dùng',
      },
      'http://localhost:3100',
    );

    expect(mail.text).toContain('Không xác định');
    expect(mail.html).toContain('Không xác định');
  });
});
