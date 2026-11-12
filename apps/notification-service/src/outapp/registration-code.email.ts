import type { AccessRegistrationCodeRequestedV1 } from '@tripflix/contracts';
import { escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

export function buildRegistrationCodeEmail(payload: AccessRegistrationCodeRequestedV1): EmailMessage {
  const intro = 'Nhập mã này trên màn hình đăng ký Tripflix. Mã có hiệu lực trong 10 phút.';
  const warning = 'Không chia sẻ mã với người khác. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.';

  const content = [
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(intro)}</p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;border:2px dashed #FF5A3C;border-radius:12px;background:#FFF0EB">',
    '  <tr>',
    '    <td align="center" style="padding:24px 16px">',
    '      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px">Mã xác thực</p>',
    `      <p style="margin:0;font-size:36px;font-weight:800;letter-spacing:8px;color:#BC331E;font-family:Consolas,monaco,monospace"><strong>${escapeHtml(payload.code)}</strong></p>`,
    '      <p style="margin:8px 0 0;font-size:12px;color:#94A3B8">Có hiệu lực trong vòng 10 phút</p>',
    '    </td>',
    '  </tr>',
    '</table>',
    `<p style="margin:0 0 8px;font-size:13px;color:#64748B;line-height:1.6">${escapeHtml(warning)}</p>`,
  ].join('\n');

  return {
    to: payload.email,
    subject: 'Mã xác thực đăng ký Tripflix',
    text: `${intro}\n\nMã xác thực: ${payload.code}\n\n${warning}`,
    html: renderEmailShell({
      title: 'Mã xác thực đăng ký Tripflix',
      badge: { text: 'MÃ XÁC THỰC', bg: '#D9F4F1', color: '#006C63' },
      heading: 'Mã xác thực đăng ký',
      content,
      footerNote: 'Email này được gửi tự động khi bạn thực hiện đăng ký tài khoản Tripflix.',
    }),
  };
}
