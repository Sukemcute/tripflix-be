import type { Redis } from 'ioredis';
import type { ServedStore } from '../application/ports.js';

const TTL_SECONDS = 48 * 3600;
const MAX_IDS = 100;
const key = (userId: string) => `discovery:recommend:served:${userId}`;

/** Danh sách bài đã phục vụ, mới nhất trước, giữ 100 id, hết hạn 48 giờ sau lần ghi cuối. */
export class RedisServedStore implements ServedStore {
  constructor(private readonly redis: Redis) {}

  list(userId: string): Promise<string[]> {
    return this.redis.lrange(key(userId), 0, MAX_IDS - 1);
  }

  async add(userId: string, postIds: string[]): Promise<void> {
    if (!postIds.length) return;
    await this.redis
      .multi()
      .lpush(key(userId), ...postIds)
      .ltrim(key(userId), 0, MAX_IDS - 1)
      .expire(key(userId), TTL_SECONDS)
      .exec();
  }
}
