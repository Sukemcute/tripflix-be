import type { AccessPasswordResetRequestedV1 } from '@tripflix/contracts';
import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

/** Email đặt lại mật khẩu, tiếng Việt. Link dùng một lần, hết hạn sau 30 phút. */
export function buildPasswordResetEmail(payload: AccessPasswordResetRequestedV1): EmailMessage {
  const minutesLeft = Math.max(1, Math.round((Date.parse(payload.expiresAt) - Date.now()) / 60_000));
  const name = escapeHtml(payload.displayName);
  const url = escapeHtml(payload.resetUrl);

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${name}</strong>,</p>`,
    '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản Tripflix của mình.</p>',
    emailButton(payload.resetUrl, 'Đặt mật khẩu mới'),
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px">',
    '  <tr>',
    '    <td style="padding:14px 18px">',
    '      <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#18242B">Lưu ý quan trọng:</p>',
    `      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5">Liên kết này chỉ có hiệu lực một lần trong vòng <strong>${minutesLeft} phút</strong>. Sau khi đặt mật khẩu mới, mọi phiên đăng nhập trên các thiết bị khác sẽ được tự động đăng xuất.</p>`,
    '    </td>',
    '  </tr>',
    '</table>',
    `<p style="margin:0 0 16px;font-size:13px;color:#64748B;line-height:1.6">Nếu nút bấm trên không mở được, bạn có thể bấm hoặc dán liên kết sau vào trình duyệt:<br><a href="${url}" style="color:#BC331E;word-break:break-all">${url}</a></p>`,
    '<p style="margin:0;font-size:13px;color:#64748B;line-height:1.6">Nếu không phải bạn yêu cầu, hãy yên tâm bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên an toàn.</p>',
  ].join('\n');

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
    html: renderEmailShell({
      title: 'Đặt lại mật khẩu Tripflix',
      badge: { text: 'BẢO MẬT TÀI KHOẢN', bg: '#FFF0EB', color: '#BC331E' },
      heading: 'Đặt lại mật khẩu Tripflix',
      content,
      footerNote: 'Email này được gửi tự động khi có yêu cầu đặt lại mật khẩu từ tài khoản của bạn.',
    }),
  };
}
