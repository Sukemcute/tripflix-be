/** Chữ có dấu tiếng Việt (thường); SQL translate() dùng danh sách này cùng bản hoa để so không dấu. */
const VIETNAMESE_MARKED_LOWER = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';

/** Chữ thường, bỏ dấu tiếng Việt: "Bảo Đăng" → "bao dang". */
export function foldVietnamese(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}

/** Cặp tham số cho translate(lower(col), from, to): mỗi chữ có dấu (cả hoa, vì lower() ở locale C chỉ đổi ASCII) → chữ không dấu. */
export const VIETNAMESE_TRANSLATE_FROM = VIETNAMESE_MARKED_LOWER + VIETNAMESE_MARKED_LOWER.toUpperCase();
export const VIETNAMESE_TRANSLATE_TO = VIETNAMESE_TRANSLATE_FROM.split('').map(foldVietnamese).join('');
