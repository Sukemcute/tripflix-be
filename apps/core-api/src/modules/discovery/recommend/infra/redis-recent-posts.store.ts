import type { Redis } from 'ioredis';
import type { RecentPostsStore } from '../application/ports.js';

export const RECENT_WINDOW_MS = 2 * 3600_000;
const MAX_POSTS = 20;
const key = (userId: string) => `discovery:recommend:recent:${userId}`;

/** ZSET bài vừa tương tác (điểm = lúc tương tác), giữ 20 bài mới nhất, hết hạn 2 giờ sau lần ghi cuối. */
export class RedisRecentPostsStore implements RecentPostsStore {
  constructor(private readonly redis: Redis) {}

  async list(userId: string, until: Date): Promise<Array<{ postId: string; at: number }>> {
    const flat = await this.redis.zrangebyscore(key(userId), until.getTime() - RECENT_WINDOW_MS, until.getTime(), 'WITHSCORES');
    const out: Array<{ postId: string; at: number }> = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ postId: flat[i]!, at: Number(flat[i + 1]) });
    return out;
  }

  async record(userId: string, change: { add: Array<{ postId: string; at: number }>; remove: string[] }): Promise<void> {
    if (!change.add.length && !change.remove.length) return;
    const k = key(userId);
    const tx = this.redis.multi();
    if (change.remove.length) tx.zrem(k, ...change.remove);
    if (change.add.length) tx.zadd(k, ...change.add.flatMap((p) => [p.at, p.postId]));
    await tx.zremrangebyrank(k, 0, -(MAX_POSTS + 1)).expire(k, RECENT_WINDOW_MS / 1000).exec();
  }
}
