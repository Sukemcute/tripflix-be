import { type INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { REALTIME_REDIS } from '../tokens.js';

/** Hai kết nối Redis riêng cho adapter: một để publish, một ở chế độ subscribe. */
export interface RealtimeRedis {
  pub: Redis;
  sub: Redis;
}

export const isRealtimeRedisReady = ({ pub, sub }: RealtimeRedis) =>
  pub.status === 'ready' && sub.status === 'ready';

/**
 * Socket.IO với Redis adapter (pub/sub): replica nào phát thì socket ở replica khác cũng nhận.
 * Redis chưa lên lúc khởi động thì service vẫn chạy; ioredis tự kết nối lại và đăng ký lại kênh, /health báo degraded trong lúc đó.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger('RedisIoAdapter');
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;

  constructor(
    app: INestApplication,
    private readonly redis: RealtimeRedis,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const results = await Promise.allSettled([
      this.connectOne(this.redis.pub),
      this.connectOne(this.redis.sub),
    ]);
    results.forEach((r) => {
      if (r.status === 'rejected')
        this.log.error({ err: r.reason }, 'Chưa kết nối được Redis cho /ws, sẽ tự thử lại');
    });
    this.adapterConstructor = createAdapter(this.redis.pub, this.redis.sub);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  private async connectOne(client: Redis): Promise<void> {
    if (client.status === 'wait') await client.connect();
  }
}

/** Gắn Redis adapter cho app; main.ts và test nhiều replica dùng chung. */
export async function useRedisRealtime(app: INestApplication): Promise<void> {
  const adapter = new RedisIoAdapter(app, app.get<RealtimeRedis>(REALTIME_REDIS));
  await adapter.connect();
  app.useWebSocketAdapter(adapter);
}
