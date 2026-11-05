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
import { loadEnv } from '@tripflix/config';
import { createPool, ping } from '@tripflix/db';
import { loggerModule } from '@tripflix/observability';
import { Redis } from 'ioredis';
import { createRemoteJWKSet } from 'jose';
import type pg from 'pg';

import { NotificationConsumer } from './consumers/notification-consumer.js';
import { RedisProcessedEvents, type ProcessedEvents } from './consumers/event-router.js';
import { envSchema, type Env } from './env.js';
import { SmtpMailer, type Mailer } from './outapp/mailer.js';
import { DB, ENV, MAILER, PROCESSED_EVENTS, REDIS, SID_BLOCKLIST_PROVIDER } from './tokens.js';

export { envSchema, type Env } from './env.js';
export { ENV, MAILER, PROCESSED_EVENTS, SID_BLOCKLIST_PROVIDER } from './tokens.js';

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
 * notification-service. Đã có: consumers/ (group "notification", email đặt lại mật khẩu). Sẽ làm (Dũng): inbox/ (WebSocket),
 * push và hàng đợi BullMQ, preferences/, grouping/ — xem docs/architecture/10 §3.5.
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
    { provide: MAILER, inject: [ENV], useFactory: (env: Env): Mailer => new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) },
    { provide: PROCESSED_EVENTS, inject: [REDIS], useFactory: (redis: Redis): ProcessedEvents => new RedisProcessedEvents(redis) },
  ],
  exports: [ENV, DB, REDIS, SID_BLOCKLIST_PROVIDER, MAILER, PROCESSED_EVENTS],
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
  providers: [NotificationConsumer],
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
