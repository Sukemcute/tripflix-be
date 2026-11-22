import type { Redis } from 'ioredis';
import {
  LOGIN_MAX_FAILS_PER_EMAIL,
  LOGIN_MAX_FAILS_PER_IP,
  LOGIN_WINDOW_SECONDS,
} from '../domain/credentials.js';
import type { LoginRateLimiter, RateLimitStatus } from '../application/ports.js';

const buildEmailKey = (email: string) => `auth:login-fail:email:${email}`;
const buildIpKey = (ip: string) => `auth:login-fail:ip:${ip}`;

/** Đếm lần đăng nhập sai trong cửa sổ 15 phút, tính từ lần sai đầu tiên. */
export class RedisLoginRateLimiter implements LoginRateLimiter {
  constructor(private readonly redis: Redis) {}

  async check(email: string, ip: string): Promise<RateLimitStatus> {
    const [byEmail, byIp] = await this.redis.mget(buildEmailKey(email), buildIpKey(ip));
    if (Number(byEmail ?? 0) >= LOGIN_MAX_FAILS_PER_EMAIL) return this.buildBlockedStatus(buildEmailKey(email));
    if (Number(byIp ?? 0) >= LOGIN_MAX_FAILS_PER_IP) return this.buildBlockedStatus(buildIpKey(ip));
    return { isBlocked: false, retryAfterSeconds: 0 };
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    await this.redis
      .multi()
      .incr(buildEmailKey(email))
      .expire(buildEmailKey(email), LOGIN_WINDOW_SECONDS, 'NX')
      .incr(buildIpKey(ip))
      .expire(buildIpKey(ip), LOGIN_WINDOW_SECONDS, 'NX')
      .exec();
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(buildEmailKey(email));
  }

  private async buildBlockedStatus(key: string): Promise<RateLimitStatus> {
    const ttl = await this.redis.ttl(key);
    return { isBlocked: true, retryAfterSeconds: ttl > 0 ? ttl : LOGIN_WINDOW_SECONDS };
  }
}
