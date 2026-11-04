import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadEnv } from '@tripflix/config';
import { DEFAULT_POOL_SIZE, MODULES, createPool } from '@tripflix/db';
import { Redis } from 'ioredis';
import { coreEnvSchema, dbUrlOf, type CoreEnv } from './env.js';
import { HealthController } from './health.controller.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from './tokens.js';

/** Hạ tầng dùng chung cho cả core-api: cấu hình, pool database theo module, Redis, /health. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CORE_ENV, useFactory: () => loadEnv(coreEnvSchema) },
    {
      provide: DB_POOLS,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv): DbPools =>
        Object.fromEntries(
          MODULES.map((m) => [
            m,
            createPool({ url: dbUrlOf(env, m), max: DEFAULT_POOL_SIZE[m], applicationName: `core-api:${m}` }),
          ]),
        ) as DbPools,
    },
    {
      provide: REDIS,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv) => new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.all(Object.values(this.pools).map((p) => p.end()));
    this.redis.disconnect();
  }
}
