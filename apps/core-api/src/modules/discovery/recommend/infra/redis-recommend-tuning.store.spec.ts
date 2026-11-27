import type { Redis } from 'ioredis';
import { RedisRecommendTuning } from './redis-recommend-tuning.store.js';

function fakeRedis() {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void data.set(key, value)),
    del: vi.fn(async (key: string) => void data.delete(key)),
    data,
  };
}

describe('RedisRecommendTuning', () => {
  it('đặt, đọc lại, null xoá khoá', async () => {
    const redis = fakeRedis();
    const tuning = new RedisRecommendTuning(redis as unknown as Redis);
    expect(await tuning.getCandidateLimit()).toBeNull();
    await tuning.setCandidateLimit(1500);
    expect(await tuning.getCandidateLimit()).toBe(1500);
    await tuning.setCandidateLimit(null);
    expect(await tuning.getCandidateLimit()).toBeNull();
    expect(redis.data.size).toBe(0);
  });

  it('giá trị hỏng trong Redis coi như chưa đặt', async () => {
    const redis = fakeRedis();
    redis.data.set('discovery:recommend:candidate-limit', 'abc');
    expect(await new RedisRecommendTuning(redis as unknown as Redis).getCandidateLimit()).toBeNull();
  });
});
