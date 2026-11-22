/**
 * Quy tắc cho chữ người dùng gõ (tên hiển thị, tên thiết bị, mật khẩu) (TF05C).
 * Dùng chung cho kiểm tra đầu vào (api/validation.ts) và tên lấy từ Google (credentials.ts).
 */
export const DISPLAY_NAME_MAX = 30;
export const DEVICE_NAME_MAX = 100;

/** Ký tự điều khiển (xuống dòng, tab, NUL…) và ký tự ngắt dòng, ngắt đoạn của Unicode. */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const CONTROL_CHARS_GLOBAL = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;
/**
 * Ký tự không nhìn thấy: khoảng trắng, ký tự định dạng (zero-width, BOM, dấu hướng chữ),
 * ký tự Unicode mặc định bị bỏ qua khi hiển thị (gồm ký tự lấp chỗ của tiếng Hàn hay bị dùng làm "tên trống").
 */
const INVISIBLE_CHARS = /[\s\p{Cf}\p{Z}\p{Default_Ignorable_Code_Point}]/gu;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/** Có ít nhất một ký tự nhìn thấy được (chữ, số, dấu, emoji…). */
export function hasVisibleChar(value: string): boolean {
  return value.replace(INVISIBLE_CHARS, '').length > 0;
}

/** Thay ký tự điều khiển bằng một dấu cách, gộp khoảng trắng liền nhau, cắt hai đầu. */
export function stripControlChars(value: string): string {
  return value
    .replace(CONTROL_CHARS_GLOBAL, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
