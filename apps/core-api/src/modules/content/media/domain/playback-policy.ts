/** Thời hạn cookie xem video mặc định: 6 giờ. App và web xin lại trước khi hết hạn. */
export const DEFAULT_PLAYBACK_TTL_SEC = 6 * 60 * 60;

/**
 * Đường dẫn CloudFront mà cookie được phép mở:
 * Mặc định mọi file dưới gốc CDN (`https://media.tripflix.io.vn/*`).
 * Khi truyền `resourcePath`, chỉ ký cho tiền tố / tài nguyên đó (ví dụ `videos/reel-123/*` hoặc `env/public/*`).
 */
export function buildPlaybackResource(cdnBaseUrl: string, resourcePath?: string): string {
  const base = cdnBaseUrl.replace(/\/+$/, '');
  if (!resourcePath || resourcePath.trim() === '') return `${base}/*`;
  const cleanPath = resourcePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${cleanPath}/*`;
}

/**
 * Chính sách tuỳ chỉnh (custom policy) của CloudFront. Phải là custom policy vì canned policy chỉ ký đúng
 * một URL, không có dấu `*`, mà một video HLS gồm nhiều playlist và nhiều đoạn `.ts`.
 */
export function buildPlaybackPolicy(resource: string, expiresAt: Date): string {
  const epochSec = Math.floor(expiresAt.getTime() / 1000);
  return JSON.stringify({
    Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': epochSec } } }],
  });
}
