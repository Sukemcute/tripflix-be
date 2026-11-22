import type { Redis } from 'ioredis';
import type { FeedPageCache, SharedFeedPage } from '../application/ports.js';

export class RedisFeedPageCache implements FeedPageCache {
  constructor(private readonly redis: Redis) {}

  async get<Card>(key: string): Promise<SharedFeedPage<Card> | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as SharedFeedPage<Card>) : null;
  }

  async set<Card>(key: string, page: SharedFeedPage<Card>, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(page), 'EX', ttlSeconds);
  }
}
