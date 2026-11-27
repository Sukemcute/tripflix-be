import type { Redis } from 'ioredis';
import type { RecommendTuning } from '../application/ports.js';

const CANDIDATE_LIMIT_KEY = 'discovery:recommend:candidate-limit';

/** Khoá không hết hạn: admin đặt thì giữ tới khi admin trả về mặc định. */
export class RedisRecommendTuning implements RecommendTuning {
  constructor(private readonly redis: Redis) {}

  async getCandidateLimit(): Promise<number | null> {
    const value = Number(await this.redis.get(CANDIDATE_LIMIT_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  async setCandidateLimit(limit: number | null): Promise<void> {
    if (limit === null) await this.redis.del(CANDIDATE_LIMIT_KEY);
    else await this.redis.set(CANDIDATE_LIMIT_KEY, String(limit));
  }
}
