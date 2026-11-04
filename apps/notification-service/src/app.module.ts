import { Controller, Get, Inject, Module, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import {
  Authenticated,
  AuthModule,
  CurrentUser,
  RedisSidBlocklist,
  createAccessTokenVerifier,
  type AuthUser,
  type SidBlocklist,
} from '@tripflix/auth';
import { baseEnvSchema, loadEnv } from '@tripflix/config';
import { createPool, ping } from '@tripflix/db';
import { loggerModule } from '@tripflix/observability';
import { Redis } from 'ioredis';
import { createRemoteJWKSet } from 'jose';
import type pg from 'pg';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL_NOTIFICATION: z.string(),
  // Khoá công khai của module access; service tự kiểm chữ ký access token.
  JWKS_URL: z.url().default('http://localhost:3000/.well-known/jwks.json'),
  AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
  AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
});
export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');
const DB = Symbol('DB');
const REDIS = Symbol('REDIS');
export const SID_BLOCKLIST_PROVIDER = Symbol('NOTIFICATION_SID_BLOCKLIST');

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

/** Người dùng đọc từ access token đã kiểm qua JWKS của core-api. */
@Controller()
export class MeController {
  @Get('me')
  @Authenticated()
  getMe(@CurrentUser() user: AuthUser) {
    return { userId: user.userId, role: user.role };
  }
}

/**
 * Khung notification-service. Phần sẽ làm (Dũng): consumers/ (group "notification"), inbox/ (WebSocket),
 * delivery/ (push, email qua BullMQ), preferences/, grouping/ — xem docs/architecture/10 §3.5.
 */
@Module({
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
    { provide: SID_BLOCKLIST_PROVIDER, inject: [REDIS], useFactory: (redis: Redis): SidBlocklist => new RedisSidBlocklist(redis) },
  ],
  exports: [ENV, DB, REDIS, SID_BLOCKLIST_PROVIDER],
})
export class InfraModule {}

@Module({
  imports: [
    loggerModule({
      service: 'notification-service',
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: process.env.NODE_ENV !== 'production',
    }),
    InfraModule,
    AuthModule.forRootAsync({
      imports: [InfraModule],
      inject: [ENV, SID_BLOCKLIST_PROVIDER],
      useFactory: (env: Env, blocklist: SidBlocklist) => ({
        verifier: createAccessTokenVerifier({
          keys: createRemoteJWKSet(new URL(env.JWKS_URL)),
          issuer: env.AUTH_JWT_ISSUER,
          audience: env.AUTH_JWT_AUDIENCE,
        }),
        blocklist,
      }),
    }),
  ],
  controllers: [HealthController, MeController],
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
