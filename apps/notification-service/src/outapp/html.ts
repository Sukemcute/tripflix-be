/** Thoát ký tự HTML cho giá trị người dùng nhập (tên hiển thị) và link chèn vào email. */
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Khung email chung: font, độ rộng, màu chữ. Style viết thẳng trong thẻ vì nhiều trình đọc email bỏ qua <style>. */
export const EMAIL_WRAPPER_OPEN =
  '<div style="font-family:\'Be Vietnam Pro\',Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18242B;line-height:1.7">';

/** Nút bấm màu cam của Tripflix. */
export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#BC331E;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:12px">${escapeHtml(label)}</a></p>`;
}

export const EMAIL_FOOTER =
  '<p style="color:#94A3B8;font-size:12px">Tripflix · Chạm cảm hứng, trọn hành trình.</p>';
