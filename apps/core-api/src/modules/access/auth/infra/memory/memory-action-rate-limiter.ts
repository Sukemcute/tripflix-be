import type { ActionRateLimiter, RateLimitStatus } from '../../application/ports.js';

/** Bản bộ nhớ của ActionRateLimiter, cùng quy tắc cửa sổ cố định; dùng cho E2E. */
export class MemoryActionRateLimiter implements ActionRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitStatus> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count > limit
      ? { isBlocked: true, retryAfterSeconds: Math.max(Math.ceil((window.resetAt - now) / 1000), 1) }
      : { isBlocked: false, retryAfterSeconds: 0 };
  }
}
