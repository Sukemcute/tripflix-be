import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

export interface LoginNotificationPayload {
  email: string;
  displayName: string;
  deviceName?: string | null | undefined;
  ipAddress?: string | null | undefined;
  location?: string | null | undefined;
  loginAt?: string | Date;
}

const ACCOUNT_SESSIONS_PATH = '/account';
const FORGOT_PASSWORD_PATH = '/forgot-password';

function formatLoginTime(loginAt?: string | Date): string {
  if (!loginAt) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
  }
  const date = typeof loginAt === 'string' ? new Date(loginAt) : loginAt;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Email gửi khi người dùng đăng nhập tài khoản Tripflix (thông báo đăng nhập / đăng nhập thiết bị mới).
 */
export function buildLoginNotificationEmail(
  payload: LoginNotificationPayload,
  webAppUrl: string,
): EmailMessage {
  const base = webAppUrl.replace(/\/+$/, '');
  const sessionsUrl = `${base}${ACCOUNT_SESSIONS_PATH}`;
  const resetUrl = `${base}${FORGOT_PASSWORD_PATH}`;
  const device = payload.deviceName ? escapeHtml(payload.deviceName) : 'Không xác định (trên một thiết bị)';
  const ip = payload.ipAddress ? escapeHtml(payload.ipAddress) : 'Không xác định';
  const location = payload.location ? escapeHtml(payload.location) : 'Việt Nam';
  const timeFormatted = formatLoginTime(payload.loginAt);

  const intro = 'Tài khoản Tripflix của bạn vừa được đăng nhập thành công với thông tin dưới đây:';
  const warning =
    'Nếu đây là bạn, bạn có thể yên tâm bỏ qua email này. Nếu bạn không nhận ra lần đăng nhập này, vui lòng đặt lại mật khẩu ngay để bảo vệ tài khoản.';

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${escapeHtml(payload.displayName)}</strong>,</p>`,
    `<p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6">${intro}</p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFC">',
    '  <tr>',
    '    <td style="padding:18px 20px">',
    '      <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">Chi tiết phiên đăng nhập</p>',
    '      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">',
    '        <tr>',
    '          <td style="padding:5px 12px 5px 0;color:#64748B;font-size:13px;width:120px">Thời gian:</td>',
    `          <td style="padding:5px 0;font-size:13px;font-weight:600;color:#18242B">${escapeHtml(timeFormatted)}</td>`,
    '        </tr>',
    '        <tr>',
    '          <td style="padding:5px 12px 5px 0;color:#64748B;font-size:13px">Thiết bị:</td>',
    `          <td style="padding:5px 0;font-size:13px;font-weight:600;color:#18242B">${device}</td>`,
    '        </tr>',
    '        <tr>',
    '          <td style="padding:5px 12px 5px 0;color:#64748B;font-size:13px">Địa chỉ IP:</td>',
    `          <td style="padding:5px 0;font-size:13px;font-weight:600;color:#18242B">${ip}</td>`,
    '        </tr>',
    '        <tr>',
    '          <td style="padding:5px 12px 5px 0;color:#64748B;font-size:13px">Khu vực ước tính:</td>',
    `          <td style="padding:5px 0;font-size:13px;font-weight:600;color:#18242B">${location}</td>`,
    '        </tr>',
    '      </table>',
    '    </td>',
    '  </tr>',
    '</table>',
    '<div style="margin:0 0 24px;padding:16px 20px;background:#FFF8F5;border-left:4px solid #FF5A3C;border-radius:0 8px 8px 0">',
    `  <p style="margin:0;font-size:13px;color:#7C2D12;line-height:1.6">🛡️ <strong>Lưu ý bảo mật:</strong> ${warning}</p>`,
    '</div>',
    emailButton(sessionsUrl, 'Quản lý phiên đăng nhập'),
    `<p style="margin:0 0 16px;font-size:14px;color:#64748B">Không phải bạn? <a href="${escapeHtml(resetUrl)}" style="color:#BC331E;font-weight:700;text-decoration:underline">Đặt lại mật khẩu ngay</a> để ngắt kết nối mọi thiết bị.</p>`,
  ].join('\n');

  return {
    to: payload.email,
    subject: 'Thông báo đăng nhập tài khoản Tripflix',
    text: [
      `Chào ${payload.displayName},`,
      '',
      intro,
      `- Thời gian: ${timeFormatted}`,
      `- Thiết bị: ${payload.deviceName ?? 'Không xác định'}`,
      `- Địa chỉ IP: ${payload.ipAddress ?? 'Không xác định'}`,
      `- Khu vực: ${payload.location ?? 'Việt Nam'}`,
      '',
      `Quản lý phiên: ${sessionsUrl}`,
      `Đặt lại mật khẩu nếu bị lộ: ${resetUrl}`,
      '',
      warning,
      '',
      'Tripflix · Chạm cảm hứng, trọn hành trình.',
    ].join('\n'),
    html: renderEmailShell({
      title: 'Thông báo đăng nhập tài khoản Tripflix',
      badge: { text: '✓ ĐĂNG NHẬP THÀNH CÔNG', bg: '#D9F4F1', color: '#006C63' },
      heading: 'Thông báo đăng nhập mới',
      content,
      footerNote: 'Email thông báo hoạt động bảo mật tài khoản từ Tripflix.',
    }),
  };
}
