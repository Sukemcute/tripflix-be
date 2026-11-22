import type { Redis } from 'ioredis';
import type { ServedStore } from '../application/ports.js';

const TTL_SECONDS = 48 * 3600;
const MAX_IDS = 100;
// ZSET (điểm = lúc gợi ý), khác kiểu với list cũ `served:` nên đổi tên key.
const key = (userId: string) => `discovery:recommend:seen:${userId}`;

/** Bài đã gợi ý kèm thời điểm, giữ 100 bài mới nhất, hết hạn 48 giờ sau lần ghi cuối. */
export class RedisServedStore implements ServedStore {
  constructor(private readonly redis: Redis) {}

  listBefore(userId: string, before: Date): Promise<string[]> {
    return this.redis.zrangebyscore(key(userId), '-inf', `(${before.getTime()}`);
  }

  async add(userId: string, postIds: string[], at: Date): Promise<void> {
    if (!postIds.length) return;
    const k = key(userId);
    await this.redis
      .multi()
      .zadd(k, ...postIds.flatMap((id) => [at.getTime(), id]))
      .zremrangebyrank(k, 0, -(MAX_IDS + 1))
      .expire(k, TTL_SECONDS)
      .exec();
  }
}
