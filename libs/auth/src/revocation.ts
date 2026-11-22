import type { Redis } from 'ioredis';

/**
 * Danh sách sid bị chặn: đăng xuất hoặc phát hiện dùng lại refresh token thì ghi sid vào đây,
 * giữ tới khi access token của phiên đó hết hạn, để token cũ bị từ chối ngay.
 */
export interface SidBlocklist {
  block(sid: string, ttlSeconds: number): Promise<void>;
  isBlocked(sid: string): Promise<boolean>;
}

/** Mọi service đọc cùng một khoá Redis, nên đặt định dạng ở đây. */
export const buildRevokedSidKey = (sid: string) => `auth:revoked-sid:${sid}`;

export class RedisSidBlocklist implements SidBlocklist {
  constructor(private readonly redis: Pick<Redis, 'set' | 'exists'>) {}

  async block(sid: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(buildRevokedSidKey(sid), '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async isBlocked(sid: string): Promise<boolean> {
    return (await this.redis.exists(buildRevokedSidKey(sid))) === 1;
  }
}

/** Bản lưu trong bộ nhớ, dùng cho test. */
export class MemorySidBlocklist implements SidBlocklist {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async block(sid: string, ttlSeconds: number): Promise<void> {
    this.until.set(sid, this.now() + Math.max(1, Math.ceil(ttlSeconds)) * 1000);
  }

  async isBlocked(sid: string): Promise<boolean> {
    const until = this.until.get(sid);
    return until !== undefined && until > this.now();
  }
}
