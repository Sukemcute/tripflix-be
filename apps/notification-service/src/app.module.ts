import { Controller, Get, Inject, Module, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import { baseEnvSchema, loadEnv } from '@tripflix/config';
import { createPool, ping } from '@tripflix/db';
import { loggerModule } from '@tripflix/observability';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { z } from 'zod';

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL_NOTIFICATION: z.string(),
});
type Env = z.infer<typeof envSchema>;

const ENV = Symbol('ENV');
const DB = Symbol('DB');
const REDIS = Symbol('REDIS');

@Controller('health')
class HealthController {
  constructor(
    @Inject(DB) private readonly db: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const db = await ping(this.db);
    const redis = await this.redis.ping().then((r) => r === 'PONG').catch(() => false);
    const body = { status: db && redis ? 'ok' : 'degraded', checks: { db, redis } };
    if (!db || !redis) throw new ServiceUnavailableException(body);
    return body;
  }
}

/**
 * Khung notification-service. Phần sẽ làm (Dũng): consumers/ (group "notification"), inbox/ (WebSocket),
 * delivery/ (push, email qua BullMQ), preferences/, grouping/ — xem docs/architecture/10 §3.5.
 */
@Module({
  imports: [
    loggerModule({
      service: 'notification-service',
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: process.env.NODE_ENV !== 'production',
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv(envSchema) },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env) =>
        createPool({ url: env.DATABASE_URL_NOTIFICATION, max: 10, applicationName: 'notification-service' }),
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.db.end();
    this.redis.disconnect();
  }
}
