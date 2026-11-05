/**
 * Chuẩn hoá chữ để so khớp: bỏ dấu tiếng Việt, đ → d, chữ thường, chỉ giữ chữ cái và số, gộp khoảng trắng.
 * Kết quả chỉ có [a-z0-9 ], nên ghép vào regex hay LIKE không cần escape.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
