/** Chữ có dấu tiếng Việt (thường); SQL translate() dùng danh sách này cùng bản hoa để so không dấu. */
const VIETNAMESE_MARKED_LOWER = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';

/** Chữ thường, bỏ dấu tiếng Việt: "Bảo Đăng" → "bao dang". */
export function foldVietnamese(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}

/** Cặp tham số cho translate(lower(col), from, to): mỗi chữ có dấu (cả hoa, vì lower() ở locale C chỉ đổi ASCII) → chữ không dấu. */
export const VIETNAMESE_TRANSLATE_FROM = VIETNAMESE_MARKED_LOWER + VIETNAMESE_MARKED_LOWER.toUpperCase();
export const VIETNAMESE_TRANSLATE_TO = VIETNAMESE_TRANSLATE_FROM.split('').map(foldVietnamese).join('');

/**
 * Từ khoá người dùng gõ → dạng so khớp: NFKC (chữ full-width, chữ tổ hợp về một dạng), gộp khoảng trắng.
 * Chỉ dùng để so, không dùng để lưu tên (UAX #15).
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * Còn ký tự điều khiển, định dạng (zero-width, đảo chiều U+202E, BOM), riêng tư hay chưa gán mã: từ chối chứ không xoá,
 * vì xoá ký tự là cách lách kiểm tra (OWASP Input Validation, UTR #36).
 */
export function hasInvisibleCharacters(query: string): boolean {
  return /\p{C}/u.test(query);
}

/** Độ dài tính sau khi bỏ dấu: "a" kèm 49 dấu tổ hợp chỉ còn 1 ký tự, không lọt được giới hạn tối thiểu. */
export function measureFoldedLength(query: string): number {
  return foldVietnamese(query).replace(/\s/gu, '').length;
}

/** Trẻ em theo Luật Trẻ em 2016 là dưới 16 tuổi: không hiện trong tìm kiếm công khai. */
export const PUBLIC_SEARCH_MIN_AGE = 16;

/** Ngày sinh muộn nhất (YYYY-MM-DD, theo UTC) của người đã đủ PUBLIC_SEARCH_MIN_AGE tuổi vào ngày `today`. */
export function buildLatestVisibleBirthDate(today: Date): string {
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - PUBLIC_SEARCH_MIN_AGE, today.getUTCMonth(), today.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}

/** Giới hạn chống dò danh sách người dùng (OWASP API4/API6): từ khoá ngắn nhất, số trang sâu nhất, số lần gọi theo IP. */
export const PUBLIC_SEARCH_QUERY_MIN = 2;
export const PUBLIC_SEARCH_QUERY_MAX = 50;
export const PUBLIC_SEARCH_PAGE_SIZE = 20;
export const PUBLIC_SEARCH_MAX_PAGE = 5;
export const PUBLIC_SEARCH_LIMITS = [
  { name: 'minute', limit: 30, windowSeconds: 60 },
  { name: 'hour', limit: 300, windowSeconds: 60 * 60 },
  { name: 'day', limit: 1000, windowSeconds: 24 * 60 * 60 },
] as const;

/**
 * Khoá giới hạn theo IP. IPv6 gộp theo /64 (một thuê bao thường được cả dải /64, đổi địa chỉ trong dải là lách được);
 * IPv4 giữ nguyên. Chuỗi không phải IP thì trả nguyên.
 */
export function buildIpRateKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.toLowerCase().split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailParts];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
