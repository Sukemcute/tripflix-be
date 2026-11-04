import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

/** Cùng image với deploy/compose.yaml. */
export const REDIS_IMAGE = 'redis:8.8-alpine';

export interface RedisFixture {
  container: StartedRedisContainer;
  url: string;
  stop(): Promise<void>;
}

/** Bật Redis thật trong Docker cho test (Streams, danh sách chặn sid, đếm đăng nhập sai). */
export async function startRedis(): Promise<RedisFixture> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  return {
    container,
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
