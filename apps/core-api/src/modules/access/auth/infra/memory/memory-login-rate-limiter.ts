import {
  LOGIN_MAX_FAILS_PER_EMAIL,
  LOGIN_MAX_FAILS_PER_IP,
  LOGIN_WINDOW_SECONDS,
} from '../../domain/credentials.js';
import type { LoginRateLimiter, RateLimitStatus } from '../../application/ports.js';

/** Cùng quy tắc với RedisLoginRateLimiter, lưu trong bộ nhớ, dùng cho test. */
export class MemoryLoginRateLimiter implements LoginRateLimiter {
  private readonly counters = new Map<string, { count: number; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async check(email: string, ip: string): Promise<RateLimitStatus> {
    for (const [key, max] of [
      [`email:${email}`, LOGIN_MAX_FAILS_PER_EMAIL],
      [`ip:${ip}`, LOGIN_MAX_FAILS_PER_IP],
    ] as const) {
      const c = this.live(key);
      if (c && c.count >= max) return { blocked: true, retryAfterSeconds: Math.ceil((c.until - this.now()) / 1000) };
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    for (const key of [`email:${email}`, `ip:${ip}`]) {
      const c = this.live(key) ?? { count: 0, until: this.now() + LOGIN_WINDOW_SECONDS * 1000 };
      this.counters.set(key, { ...c, count: c.count + 1 });
    }
  }

  async reset(email: string): Promise<void> {
    this.counters.delete(`email:${email}`);
  }

  private live(key: string) {
    const c = this.counters.get(key);
    return c && c.until > this.now() ? c : undefined;
  }
}
