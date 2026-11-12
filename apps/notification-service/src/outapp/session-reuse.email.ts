import type { AccessSessionReuseDetectedV1 } from '@tripflix/contracts';
import { escapeHtml } from './html.js';
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
    html: [
      '<div style="font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18242B;line-height:1.7">',
      '<p style="font-size:22px;font-weight:700;margin:0 0 16px">Phiên đăng nhập đã bị đăng xuất</p>',
      `<p>Chào ${escapeHtml(payload.displayName)},</p>`,
      `<p>${escapeHtml(reason)}</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:12px">Đăng nhập lại</a></p>`,
      `<p>${escapeHtml(advice)} <a href="${escapeHtml(resetUrl)}">Đặt lại mật khẩu</a></p>`,
      '<p style="color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>',
      '</div>',
    ].join('\n'),
  };
}
