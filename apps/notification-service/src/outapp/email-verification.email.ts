import type { AccessEmailVerificationRequestedV1 } from '@tripflix/contracts';
import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';
import { BENEFITS } from './welcome.email.js';

function hoursLeft(expiresAt: string): number {
  return Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 3_600_000));
}

/**
 * Email xác nhận địa chỉ email (TF05D), tiếng Việt. reason "signup": email đầu tiên sau khi đăng ký bằng mật khẩu,
 * gộp lời chào mừng (không gửi email chào mừng riêng). "resend": chỉ có link xác thực.
 */
export function buildEmailVerificationEmail(payload: AccessEmailVerificationRequestedV1): EmailMessage {
  const isSignup = payload.reason === 'signup';
  const name = escapeHtml(payload.displayName);
  const hours = hoursLeft(payload.expiresAt);
  const why = 'Xác nhận email để đăng bài, bình luận và nhận thông tin đặt chỗ.';
  const validity = `Link dùng được một lần trong ${hours} giờ.`;
  const notYou = isSignup
    ? 'Nếu không phải bạn tạo tài khoản này, hãy bỏ qua email này: tài khoản sẽ không được xác thực.'
    : 'Nếu không phải bạn yêu cầu, hãy bỏ qua email này.';

  const benefitsHtml = isSignup
    ? [
        '<p style="margin:0 0 12px;font-size:14px;color:#334155">Cảm ơn bạn đã tạo tài khoản Tripflix. Sau khi xác nhận email, bạn có thể:</p>',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px 16px">',
        ...BENEFITS.map(
          (b) =>
            `  <tr><td style="padding:6px 0;font-size:14px;color:#334155"><span style="color:#006C63;font-weight:700;margin-right:8px">✓</span>${escapeHtml(b)}</td></tr>`,
        ),
        '</table>',
      ].join('\n')
    : '';

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${name}</strong>,</p>`,
    benefitsHtml,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(why)}</p>`,
    emailButton(payload.verifyUrl, 'Xác nhận email'),
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px">',
    '  <tr>',
    '    <td style="padding:14px 18px">',
    `      <p style="margin:0 0 6px;color:#64748B;font-size:13px">${escapeHtml(validity)} Nút không bấm được thì chép link này vào trình duyệt:</p>`,
    `      <p style="margin:0;font-size:13px"><a href="${escapeHtml(payload.verifyUrl)}" style="color:#BC331E;word-break:break-all">${escapeHtml(payload.verifyUrl)}</a></p>`,
    '    </td>',
    '  </tr>',
    '</table>',
    `<p style="margin:0 0 12px;color:#64748B;font-size:13px;line-height:1.6">${escapeHtml(notYou)}</p>`,
  ].join('\n');

  return {
    to: payload.email,
    subject: isSignup
      ? 'Chào mừng bạn đến với Tripflix, hãy xác nhận email'
      : 'Xác nhận email Tripflix của bạn',
    text: [
      `Chào ${payload.displayName},`,
      '',
      ...(isSignup
        ? [
            'Cảm ơn bạn đã tạo tài khoản Tripflix. Sau khi xác nhận email, bạn có thể:',
            ...BENEFITS.map((b) => `- ${b}`),
            '',
          ]
        : []),
      why,
      `Mở link sau để xác nhận. ${validity}`,
      payload.verifyUrl,
      '',
      notYou,
      '',
      'Tripflix · Chạm cảm hứng, trọn hành trình.',
    ].join('\n'),
    html: renderEmailShell({
      title: isSignup ? 'Chào mừng bạn đến với Tripflix' : 'Xác nhận email Tripflix',
      badge: {
        text: isSignup ? 'CHÀO MỪNG BẠN' : 'XÁC THỰC EMAIL',
        bg: '#D9F4F1',
        color: '#006C63',
      },
      heading: isSignup ? 'Chào mừng bạn đến với Tripflix 👋' : 'Xác nhận email của bạn',
      content,
      footerNote: 'Email này được gửi tự động để xác minh địa chỉ email đăng ký trên Tripflix.',
    }),
  };
}
