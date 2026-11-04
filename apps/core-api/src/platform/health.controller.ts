import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ping } from '@tripflix/db';
import type { Redis } from 'ioredis';
import type { CoreEnv } from './env.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from './tokens.js';

const TIMEOUT_MS = 3_000;

const withTimeout = <T>(p: Promise<T>, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS))]);

@Controller('health')
export class HealthController {
  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'ping'>,
  ) {}

  /** Kiểm kết nối của từng module tới Postgres (bằng user riêng) và Redis. */
  @Get()
  async check() {
    const entries = await Promise.all(
      Object.entries(this.pools).map(async ([name, pool]) => [name, await withTimeout(ping(pool), false)] as const),
    );
    const db = Object.fromEntries(entries);
    const redis = await withTimeout(
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
      false,
    );
    const ok = entries.every(([, up]) => up) && redis;
    const body = { status: ok ? 'ok' : 'degraded', role: this.env.APP_ROLE, checks: { db, redis } };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
