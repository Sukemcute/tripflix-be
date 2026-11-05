import type { AccessPasswordResetRequestedV1 } from '@tripflix/contracts';
import type { EmailMessage } from './mailer.js';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Email đặt lại mật khẩu, tiếng Việt. Link dùng một lần, hết hạn sau 30 phút. */
export function buildPasswordResetEmail(payload: AccessPasswordResetRequestedV1): EmailMessage {
  const minutesLeft = Math.max(1, Math.round((Date.parse(payload.expiresAt) - Date.now()) / 60_000));
  const name = escapeHtml(payload.displayName);
  const url = escapeHtml(payload.resetUrl);
  return {
    to: payload.email,
    subject: 'Đặt lại mật khẩu Tripflix',
    text: [
      `Chào ${payload.displayName},`,
      '',
      'Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản Tripflix.',
      `Mở link sau để đặt mật khẩu mới, link dùng được một lần trong ${minutesLeft} phút:`,
      payload.resetUrl,
      '',
      'Nếu không phải bạn yêu cầu, hãy bỏ qua email này. Mật khẩu hiện tại vẫn giữ nguyên.',
    ].join('\n'),
    html: [
      `<p>Chào ${name},</p>`,
      '<p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản Tripflix.</p>',
      `<p><a href="${url}">Đặt mật khẩu mới</a> (link dùng được một lần trong ${minutesLeft} phút).</p>`,
      '<p>Nếu không phải bạn yêu cầu, hãy bỏ qua email này. Mật khẩu hiện tại vẫn giữ nguyên.</p>',
    ].join('\n'),
  };
}
