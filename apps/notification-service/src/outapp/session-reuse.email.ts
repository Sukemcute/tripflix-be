import type { AccessSessionReuseDetectedV1 } from '@tripflix/contracts';
import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

/** Đường dẫn trên web (tripflix-fe/apps/web/src/app): trang đăng nhập và quên mật khẩu. */
const LOGIN_PATH = '/login';
const FORGOT_PASSWORD_PATH = '/forgot-password';

/**
 * Email gửi khi refresh token cũ của một phiên bị dùng lại: phiên đã bị huỷ, chủ tài khoản bị đăng xuất trên thiết bị đó.
 * Đặt lại mật khẩu huỷ mọi phiên còn lại, nên đó là việc nên làm nếu người dùng không nhận ra.
 */
export function buildSessionReuseEmail(payload: AccessSessionReuseDetectedV1, webAppUrl: string): EmailMessage {
  const base = webAppUrl.replace(/\/+$/, '');
  const loginUrl = `${base}${LOGIN_PATH}`;
  const resetUrl = `${base}${FORGOT_PASSWORD_PATH}`;
  const device = payload.deviceName ? `trên thiết bị "${payload.deviceName}"` : 'trên một thiết bị';
  const reason = `Chúng tôi vừa đăng xuất phiên đăng nhập Tripflix của bạn ${device} vì phát hiện mã đăng nhập cũ bị dùng lại, dấu hiệu có thể bị đánh cắp.`;
  const advice = 'Nếu bạn không nhận ra việc này, hãy đặt lại mật khẩu ngay: mọi thiết bị khác cũng sẽ bị đăng xuất.';

  const deviceDisplay = payload.deviceName ? escapeHtml(payload.deviceName) : 'Không xác định (trên một thiết bị)';

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${escapeHtml(payload.displayName)}</strong>,</p>`,
    `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6">${escapeHtml(reason)}</p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFC">',
    '  <tr>',
    '    <td style="padding:16px 20px">',
    '      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">Chi tiết phiên hoạt động</p>',
    '      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">',
    '        <tr>',
    '          <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px;width:110px">Thiết bị:</td>',
    `          <td style="padding:4px 0;font-size:13px;font-weight:600;color:#18242B">${deviceDisplay}</td>`,
    '        </tr>',
    '        <tr>',
    '          <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px">Hành động:</td>',
    '          <td style="padding:4px 0;font-size:13px;font-weight:600;color:#BC331E">Đã thu hồi phiên và đăng xuất</td>',
    '        </tr>',
    '      </table>',
    '    </td>',
    '  </tr>',
    '</table>',
    '<div style="margin:0 0 24px;padding:16px 20px;background:#FFF0EB;border-left:4px solid #BC331E;border-radius:0 8px 8px 0">',
    `  <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6">🔒 <strong>Cảnh báo bảo mật:</strong> ${escapeHtml(advice)}</p>`,
    '</div>',
    emailButton(loginUrl, 'Đăng nhập lại'),
    `<p style="margin:0 0 16px;font-size:14px;color:#64748B">${escapeHtml(advice)} <a href="${escapeHtml(resetUrl)}" style="color:#BC331E;font-weight:700;text-decoration:underline">Đặt lại mật khẩu</a></p>`,
  ].join('\n');

  return {
    to: payload.email,
    subject: 'Phiên đăng nhập Tripflix của bạn đã bị đăng xuất',
    text: [
      `Chào ${payload.displayName},`,
      '',
      reason,
      '',
      `Đăng nhập lại: ${loginUrl}`,
      `${advice} ${resetUrl}`,
      '',
      'Tripflix · Chạm cảm hứng, trọn hành trình.',
    ].join('\n'),
    html: renderEmailShell({
      title: 'Phiên đăng nhập đã bị đăng xuất',
      badge: { text: '🔒 CẢNH BÁO BẢO MẬT', bg: '#FFF0EB', color: '#BC331E' },
      heading: 'Phiên đăng nhập đã bị đăng xuất',
      content,
      footerNote: 'Email bảo mật tự động gửi đến địa chỉ đã đăng ký tài khoản Tripflix của bạn.',
    }),
  };
}
