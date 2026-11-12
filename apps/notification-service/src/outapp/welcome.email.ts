import type { AccessUserWelcomeEmailRequestedV1 } from '@tripflix/contracts';
import { emailButton, escapeHtml, renderEmailShell } from './html.js';
import type { EmailMessage } from './mailer.js';

/** Lợi ích liệt kê trong email chào mừng và email xác thực lúc đăng ký. */
export const BENEFITS = [
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
 * Email chào mừng khi tạo tài khoản, tiếng Việt.
 */
export function buildWelcomeEmail(payload: AccessUserWelcomeEmailRequestedV1, webAppUrl: string): EmailMessage {
  const name = escapeHtml(payload.displayName);
  const via = payload.provider === 'google' ? ' bằng Google' : '';

  const benefitsListHtml = BENEFITS.map(
    (b) =>
      `<tr><td style="padding:6px 0;font-size:14px;color:#334155"><span style="color:#006C63;font-weight:700;margin-right:8px">✓</span>${escapeHtml(b)}</td></tr>`,
  ).join('');

  const content = [
    `<p style="margin:0 0 16px;font-size:15px">Chào <strong>${name}</strong>,</p>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">Cảm ơn bạn đã tạo tài khoản Tripflix${via}. Từ giờ bạn có thể trải nghiệm đầy đủ các tính năng hấp dẫn:</p>`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0 20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px 16px">`,
    benefitsListHtml,
    '</table>',
    emailButton(webAppUrl, 'Khám phá ngay'),
    '<div style="margin:20px 0 12px;padding:14px 18px;background:#FFF0EB;border-left:4px solid #FF5A3C;border-radius:0 8px 8px 0">',
    `  <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#BC331E">Thông tin đăng nhập</p>`,
    `  <p style="margin:0;font-size:13px;color:#475569;line-height:1.5">${escapeHtml(describeSignIn(payload))}</p>`,
    '</div>',
    '<p style="margin:0 0 12px;color:#64748B;font-size:13px">Nếu không phải bạn tạo tài khoản này, hãy bỏ qua email này.</p>',
  ].join('\n');

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
    html: renderEmailShell({
      title: 'Chào mừng bạn đến với Tripflix',
      badge: { text: 'CHÀO MỪNG BẠN', bg: '#D9F4F1', color: '#006C63' },
      heading: 'Chào mừng bạn đến với Tripflix 👋',
      content,
      footerNote: 'Email này được gửi tự động khi tài khoản Tripflix của bạn được kích hoạt thành công.',
    }),
  };
}
