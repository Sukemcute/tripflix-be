import type { AccessRegistrationAttemptedExistingV1 } from '@tripflix/contracts';
import { escapeHtml } from './html.js';
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
  const warning = 'Nếu không phải bạn vừa đăng ký, hãy bỏ qua email này. Tài khoản của bạn không thay đổi gì.';
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
    html: [
      '<div style="font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18242B;line-height:1.7">',
      '<p style="font-size:22px;font-weight:700;margin:0 0 16px">Bạn đã có tài khoản Tripflix</p>',
      `<p>Chào ${escapeHtml(payload.displayName)},</p>`,
      `<p>Có người vừa đăng ký Tripflix bằng ${escapeHtml(payload.email)}, nhưng email này đã có tài khoản nên chúng tôi không gửi mã đăng ký.</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:12px">Đăng nhập</a></p>`,
      `<p>${escapeHtml(signIn)} <a href="${escapeHtml(forgotUrl)}">${payload.hasPassword ? 'Đặt lại mật khẩu' : 'Tạo mật khẩu'}</a></p>`,
      `<p style="color:#64748B;font-size:13px">${warning}</p>`,
      '<p style="color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>',
      '</div>',
    ].join('\n'),
  };
}
