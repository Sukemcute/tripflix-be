import type { AccessUserWelcomeEmailRequestedV1 } from '@tripflix/contracts';
import type { EmailMessage } from './mailer.js';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BENEFITS = [
  'Lưu chuyến đi và khách sạn bạn yêu thích',
  'Bình luận, chia sẻ trải nghiệm cùng cộng đồng',
  'Nhận gợi ý điểm đến, nơi ở đúng gu',
];

/** Câu cho biết đăng nhập lại bằng cách nào; tài khoản Google chưa có mật khẩu. */
function describeSignIn(payload: AccessUserWelcomeEmailRequestedV1): string {
  return payload.provider === 'google'
    ? `Bạn đăng nhập bằng tài khoản Google ${payload.email}. Muốn đăng nhập bằng mật khẩu, hãy dùng "Quên mật khẩu" để tạo mật khẩu.`
    : `Bạn đăng nhập bằng email ${payload.email} và mật khẩu đã tạo.`;
}

/**
 * Email chào mừng khi tạo tài khoản, tiếng Việt. Style viết thẳng trong thẻ (inline) vì nhiều trình đọc email
 * bỏ qua thẻ <style>.
 */
export function buildWelcomeEmail(payload: AccessUserWelcomeEmailRequestedV1, webAppUrl: string): EmailMessage {
  const name = escapeHtml(payload.displayName);
  const url = escapeHtml(webAppUrl);
  const via = payload.provider === 'google' ? ' bằng Google' : '';
  return {
    to: payload.email,
    subject: 'Chào mừng bạn đến với Tripflix',
    text: [
      `Chào ${payload.displayName},`,
      '',
      `Cảm ơn bạn đã tạo tài khoản Tripflix${via}. Từ giờ bạn có thể:`,
      ...BENEFITS.map((benefit) => `- ${benefit}`),
      '',
      `Bắt đầu khám phá: ${webAppUrl}`,
      '',
      describeSignIn(payload),
      'Nếu không phải bạn tạo tài khoản này, hãy bỏ qua email này.',
      '',
      'Tripflix · Chạm cảm hứng, trọn hành trình.',
    ].join('\n'),
    html: [
      '<div style="font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18242B;line-height:1.7">',
      '<p style="font-size:22px;font-weight:700;margin:0 0 16px">Chào mừng bạn đến với Tripflix 👋</p>',
      `<p>Chào ${name},</p>`,
      `<p>Cảm ơn bạn đã tạo tài khoản Tripflix${via}. Từ giờ bạn có thể:</p>`,
      `<ul>${BENEFITS.map((benefit) => `<li>${benefit}</li>`).join('')}</ul>`,
      `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:12px">Khám phá ngay</a></p>`,
      `<p style="color:#64748B;font-size:13px">${escapeHtml(describeSignIn(payload))}<br>Nếu không phải bạn tạo tài khoản này, hãy bỏ qua email này.</p>`,
      '<p style="color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>',
      '</div>',
    ].join('\n'),
  };
}
