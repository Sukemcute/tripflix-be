import type { AccessEmailVerificationRequestedV1 } from '@tripflix/contracts';
import { EMAIL_FOOTER, EMAIL_WRAPPER_OPEN, emailButton, escapeHtml } from './html.js';
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
    html: [
      EMAIL_WRAPPER_OPEN,
      `<p style="font-size:22px;font-weight:700;margin:0 0 16px">${isSignup ? 'Chào mừng bạn đến với Tripflix 👋' : 'Xác nhận email của bạn'}</p>`,
      `<p>Chào ${name},</p>`,
      ...(isSignup
        ? [
            '<p>Cảm ơn bạn đã tạo tài khoản Tripflix. Sau khi xác nhận email, bạn có thể:</p>',
            `<ul>${BENEFITS.map((b) => `<li>${b}</li>`).join('')}</ul>`,
          ]
        : []),
      `<p>${why}</p>`,
      emailButton(payload.verifyUrl, 'Xác nhận email'),
      `<p style="color:#64748B;font-size:13px">${validity} Nút không bấm được thì chép link này vào trình duyệt:<br><a href="${escapeHtml(payload.verifyUrl)}" style="color:#64748B;word-break:break-all">${escapeHtml(payload.verifyUrl)}</a></p>`,
      `<p style="color:#64748B;font-size:13px">${notYou}</p>`,
      EMAIL_FOOTER,
      '</div>',
    ].join('\n'),
  };
}
