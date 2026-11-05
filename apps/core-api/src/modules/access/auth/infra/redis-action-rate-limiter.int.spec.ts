import { startRedis, type RedisFixture } from '@tripflix/testing';
import { Redis } from 'ioredis';
import { RedisActionRateLimiter } from './redis-action-rate-limiter.js';

// Giới hạn quên mật khẩu dựa vào INCR + EXPIRE NX: kiểm trên Redis thật (cùng image với compose).
describe('RedisActionRateLimiter trên Redis thật', () => {
  let redisFixture: RedisFixture;
  let redis: Redis;
  let limiter: RedisActionRateLimiter;

  beforeAll(async () => {
    redisFixture = await startRedis();
    redis = new Redis(redisFixture.url);
    limiter = new RedisActionRateLimiter(redis);
  });

  afterAll(async () => {
    redis?.disconnect();
    await redisFixture?.stop();
  });

  it('cho đủ limit lần, lần sau bị chặn kèm thời gian chờ; hạn không bị kéo dài khi gọi tiếp', async () => {
    for (let i = 0; i < 3; i += 1) expect((await limiter.consume('forgot:email:a@example.com', 3, 3600)).isBlocked).toBe(false);
    const blocked = await limiter.consume('forgot:email:a@example.com', 3, 3600);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(3590);
    expect(await redis.get('auth:action:forgot:email:a@example.com')).toBe('4');

    await redis.expire('auth:action:forgot:email:a@example.com', 100);
    await limiter.consume('forgot:email:a@example.com', 3, 3600);
    expect(await redis.ttl('auth:action:forgot:email:a@example.com')).toBeLessThanOrEqual(100);
  });

  it('20 request cùng lúc với limit 3: đúng 3 request được cho qua', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consume('forgot:ip:10.0.0.1', 3, 60)));
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(3);
  });
});
