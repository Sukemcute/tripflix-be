import { createHash, randomBytes } from 'node:crypto';

/** Refresh token là chuỗi ngẫu nhiên 256 bit, không phải JWT. */
export function createRefreshToken(browserKey?: string): string {
  const secret = randomBytes(32).toString('base64url');
  return browserKey ? `w1.${secret}.${browserKey}` : secret;
}

export function getRefreshBrowserKey(token: string): string | undefined {
  return /^w1\.[A-Za-z0-9_-]{43}\.([A-Za-z0-9_-]{43})$/.exec(token)?.[1];
}

/** Token đủ ngẫu nhiên nên SHA-256 là đủ; database chỉ giữ bản băm này. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
