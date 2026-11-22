/** Thoát ký tự HTML cho giá trị người dùng nhập (tên hiển thị) và link chèn vào email. */
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Khung email chung: font, độ rộng, màu chữ (giữ tương thích). */
export const EMAIL_WRAPPER_OPEN =
  '<div style="font-family:\'Be Vietnam Pro\',-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18242B;line-height:1.7">';

/** Nút bấm màu đỏ cam thương hiệu Tripflix (chuẩn bảng email HTML tương thích mọi ứng dụng đọc mail). */
export function emailButton(href: string, label: string): string {
  return [
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 20px">',
    '  <tr>',
    '    <td align="center" bgcolor="#BC331E" style="border-radius:12px">',
    `      <a href="${escapeHtml(href)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:12px;letter-spacing:0.3px">${escapeHtml(label)}</a>`,
    '    </td>',
    '  </tr>',
    '</table>',
  ].join('\n');
}

export const EMAIL_FOOTER =
  '<p style="color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>';

export interface EmailBadge {
  text: string;
  bg?: string;
  color?: string;
}

export interface EmailShellOptions {
  title: string;
  badge?: EmailBadge | undefined;
  heading?: string | undefined;
  content: string;
  footerNote?: string | undefined;
}

/**
 * Khung email giao diện chuẩn thương hiệu Tripflix:
 * - Tương thích hoàn hảo mọi ứng dụng email (Gmail, Apple Mail, Outlook, Thunderbird, Webmail).
 * - Sử dụng bảng HTML (table-based layout), nền màu be ấm #FFF7F2, thẻ card trắng bo góc 16px viền #E2E8F0.
 * - Header nhận diện thương hiệu với logo đỏ cam #FF5A3C font 800 và slogan Tripflix.
 * - Footer tự động chuẩn mực, minh bạch.
 */
export function renderEmailShell(options: EmailShellOptions): string {
  const badgeHtml = options.badge
    ? `<span style="display:inline-block;padding:5px 12px;border-radius:20px;background:${options.badge.bg || '#FFF0EB'};color:${options.badge.color || '#BC331E'};font-size:12px;font-weight:700;letter-spacing:0.5px">${escapeHtml(options.badge.text)}</span>`
    : '';

  const headingHtml = options.heading
    ? `<h1 style="margin:16px 0 12px;font-size:24px;line-height:1.3;color:#18242B;font-weight:800">${escapeHtml(options.heading)}</h1>`
    : '';

  const footerNote = options.footerNote
    ? `<p style="margin:0 0 6px;color:#64748B;font-size:12px">${escapeHtml(options.footerNote)}</p>`
    : '<p style="margin:0 0 6px;color:#64748B;font-size:12px">Email này được gửi tự động từ hệ thống Tripflix, vui lòng không trả lời thư này.</p>';

  return [
    '<!DOCTYPE html>',
    '<html lang="vi">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${escapeHtml(options.title)}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background:#FFF7F2;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">',
    '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF7F2;font-family:\'Be Vietnam Pro\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;color:#18242B;line-height:1.7">',
    '    <tr>',
    '      <td align="center" style="padding:28px 12px">',
    '        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;box-shadow:0 4px 12px rgba(24,36,43,0.04)">',
    '          <tr>',
    '            <td style="padding:28px 24px 22px;border-bottom:1px solid #E2E8F0">',
    '              <p style="margin:0;color:#FF5A3C;font-size:28px;font-weight:800;letter-spacing:-0.5px">Tripflix</p>',
    '              <p style="margin:4px 0 0;color:#64748B;font-size:12px">Chạm cảm hứng, trọn hành trình.</p>',
    '            </td>',
    '          </tr>',
    '          <tr>',
    '            <td style="padding:28px 24px 16px;overflow-wrap:anywhere;word-wrap:break-word">',
    badgeHtml ? `              <div>${badgeHtml}</div>` : '',
    headingHtml ? `              ${headingHtml}` : '',
    `              ${options.content}`,
    '            </td>',
    '          </tr>',
    '          <tr>',
    '            <td style="padding:20px 24px;border-top:1px solid #E2E8F0;background:#FAFAFA;border-bottom-left-radius:16px;border-bottom-right-radius:16px">',
    `              ${footerNote}`,
    '              <p style="margin:0;color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>',
    '            </td>',
    '          </tr>',
    '        </table>',
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}
