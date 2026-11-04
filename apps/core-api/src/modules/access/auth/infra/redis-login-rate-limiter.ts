import type { Redis } from 'ioredis';
import {
  LOGIN_MAX_FAILS_PER_EMAIL,
  LOGIN_MAX_FAILS_PER_IP,
  LOGIN_WINDOW_SECONDS,
} from '../domain/credentials.js';
import type { LoginRateLimiter, RateLimitStatus } from '../application/ports.js';

const emailKey = (email: string) => `auth:login-fail:email:${email}`;
const ipKey = (ip: string) => `auth:login-fail:ip:${ip}`;

/** Đếm lần đăng nhập sai trong cửa sổ 15 phút, tính từ lần sai đầu tiên. */
export class RedisLoginRateLimiter implements LoginRateLimiter {
  constructor(private readonly redis: Redis) {}

  async check(email: string, ip: string): Promise<RateLimitStatus> {
    const [byEmail, byIp] = await this.redis.mget(emailKey(email), ipKey(ip));
    if (Number(byEmail ?? 0) >= LOGIN_MAX_FAILS_PER_EMAIL) return this.blocked(emailKey(email));
    if (Number(byIp ?? 0) >= LOGIN_MAX_FAILS_PER_IP) return this.blocked(ipKey(ip));
    return { blocked: false, retryAfterSeconds: 0 };
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    await this.redis
      .multi()
      .incr(emailKey(email))
      .expire(emailKey(email), LOGIN_WINDOW_SECONDS, 'NX')
      .incr(ipKey(ip))
      .expire(ipKey(ip), LOGIN_WINDOW_SECONDS, 'NX')
      .exec();
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(emailKey(email));
  }

  private async blocked(key: string): Promise<RateLimitStatus> {
    const ttl = await this.redis.ttl(key);
    return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : LOGIN_WINDOW_SECONDS };
  }
}
