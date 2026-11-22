import type { AccessRegistrationAttemptedExistingV1 } from '@tripflix/contracts';
import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

/** Đường dẫn trên web (tripflix-fe/apps/web/src/app): trang đăng nhập và quên mật khẩu. */
const LOGIN_PATH = '/login';
const FORGOT_PASSWORD_PATH = '/forgot-password';

/** Câu cho biết cách đăng nhập; tài khoản Google chưa có mật khẩu. */
function describeSignIn(payload: AccessRegistrationAttemptedExistingV1): string {
  return payload.hasPassword
    ? 'Bạn có thể đăng nhập bằng email này và mật khẩu đã tạo. Quên mật khẩu thì đặt lại tại đây:'
    : 'Tài khoản này đăng nhập bằng Google. Muốn đăng nhập bằng mật khẩu, hãy tạo mật khẩu tại đây:';
}

/**
 * Email gửi khi ai đó xin mã đăng ký bằng email đã có tài khoản. Màn hình đăng ký không báo gì để không lộ email
 * đã đăng ký, nên chủ email biết qua thư này.
 */
export function buildExistingAccountEmail(payload: AccessRegistrationAttemptedExistingV1, webAppUrl: string): EmailMessage {
  const base = webAppUrl.replace(/\/+$/, '');
  const loginUrl = `${base}${LOGIN_PATH}`;
  const forgotUrl = `${base}${FORGOT_PASSWORD_PATH}`;
  const signIn = describeSignIn(payload);
  const actionLabel = payload.hasPassword ? 'Đặt lại mật khẩu' : 'Tạo mật khẩu';
  const warning = 'Nếu không phải bạn vừa đăng ký, hãy bỏ qua email này. Tài khoản của bạn không thay đổi gì.';

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${escapeHtml(payload.displayName)}</strong>,</p>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">Có người vừa nhập email <strong>${escapeHtml(payload.email)}</strong> để đăng ký tài khoản Tripflix. Do email này đã được sử dụng cho một tài khoản hiện có, chúng tôi không gửi mã đăng ký mới.</p>`,
    emailButton(loginUrl, 'Đăng nhập ngay'),
    '<div style="margin:20px 0;padding:16px 20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px">',
    `  <p style="margin:0 0 6px;font-size:14px;color:#334155">${escapeHtml(signIn)}</p>`,
    `  <p style="margin:0"><a href="${escapeHtml(forgotUrl)}" style="color:#BC331E;font-weight:700;font-size:14px;text-decoration:underline">${actionLabel}</a></p>`,
    '</div>',
    `<p style="margin:0 0 12px;color:#64748B;font-size:13px;line-height:1.6">${warning}</p>`,
  ].join('\n');

  return {
    to: payload.email,
    subject: 'Email này đã có tài khoản Tripflix',
    text: [
      `Chào ${payload.displayName},`,
      '',
      `Có người vừa đăng ký Tripflix bằng ${payload.email}, nhưng email này đã có tài khoản nên chúng tôi không gửi mã đăng ký.`,
      '',
      `Đăng nhập: ${loginUrl}`,
      `${signIn} ${forgotUrl}`,
      '',
      warning,
      '',
      'Tripflix · Chạm cảm hứng, trọn hành trình.',
    ].join('\n'),
    html: renderEmailShell({
      title: 'Bạn đã có tài khoản Tripflix',
      badge: { text: 'THÔNG BÁO TÀI KHOẢN', bg: '#D9F4F1', color: '#006C63' },
      heading: 'Bạn đã có tài khoản Tripflix',
      content,
      footerNote: 'Email bảo mật gửi đến địa chỉ đã đăng ký tại Tripflix.',
    }),
  };
}
