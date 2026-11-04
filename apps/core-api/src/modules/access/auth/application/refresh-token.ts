import { createHash, randomBytes } from 'node:crypto';

/** Refresh token là chuỗi ngẫu nhiên 256 bit, không phải JWT. */
export function createRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Token đủ ngẫu nhiên nên SHA-256 là đủ; database chỉ giữ bản băm này. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
