import type { Redis } from 'ioredis';
import type { ActionRateLimiter, RateLimitStatus } from '../application/ports.js';

/** Cửa sổ cố định tính từ lần đầu: INCR rồi đặt hạn một lần (EXPIRE NX). Khoá dạng auth:action:<key>. */
export class RedisActionRateLimiter implements ActionRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitStatus> {
    const redisKey = `auth:action:${key}`;
    const results = await this.redis.multi().incr(redisKey).expire(redisKey, windowSeconds, 'NX').ttl(redisKey).exec();
    if (!results || results.some(([error]) => error)) throw new Error('Không kiểm tra được giới hạn xác thực');
    const count = Number(results[0]?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Kết quả giới hạn xác thực không hợp lệ');
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    return count > limit ? { isBlocked: true, retryAfterSeconds: Math.max(ttl, 1) } : { isBlocked: false, retryAfterSeconds: 0 };
  }
}
