import type { Redis } from 'ioredis';
import type { IngestQuota } from '../application/ports.js';

const TTL_SECONDS = 2 * 86_400;
const key = (actorId: string, kind: string, day: string) => `discovery:recommend:ingest-quota:${day}:${kind}:${actorId}`;

/** Bộ đếm INCRBY theo (người, loại, ngày); khoá tự hết hạn nên không cần dọn. */
export class RedisIngestQuota implements IngestQuota {
  constructor(private readonly redis: Redis) {}

  async add(actorId: string, kind: string, day: string, count: number): Promise<number> {
    const k = key(actorId, kind, day);
    const res = await this.redis.multi().incrby(k, count).expire(k, TTL_SECONDS).exec();
    const [err, total] = res?.[0] ?? [new Error('Redis không trả kết quả MULTI'), null];
    if (err) throw err;
    return Number(total);
  }
}
