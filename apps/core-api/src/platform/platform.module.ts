import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadEnv } from '@tripflix/config';
import { DEFAULT_POOL_SIZE, MODULES, buildDrizzleToken, createDb, createPool, createTransactionalPlugins } from '@tripflix/db';
import { Redis } from 'ioredis';
import { ClsModule } from 'nestjs-cls';
import { coreEnvSchema, dbUrlOf, type CoreEnv } from './env.js';
import { HealthController } from './health.controller.js';
import { CORE_ENV, DB_POOLS, REDIS, type DbPools } from './tokens.js';

const DRIZZLE_TOKENS = MODULES.map((m) => buildDrizzleToken(m));

/** Cấu hình, pool database và instance Drizzle theo module, Redis. Tách riêng để ClsModule import được. */
@Global()
@Module({
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
    // Mỗi module một instance Drizzle trên pool (user Postgres) riêng; @Transactional('<module>') dùng instance này.
    ...MODULES.map((m) => ({
      provide: buildDrizzleToken(m),
      inject: [DB_POOLS],
      useFactory: (pools: DbPools) => createDb(pools[m]),
    })),
    {
      provide: REDIS,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv) => new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS, ...DRIZZLE_TOKENS],
})
export class PlatformCoreModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.all(Object.values(this.pools).map((p) => p.end()));
    this.redis.disconnect();
  }
}

/** Hạ tầng dùng chung cho cả core-api: PlatformCoreModule, @Transactional theo module, /health. */
@Global()
@Module({
  imports: [
    PlatformCoreModule,
    ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([PlatformCoreModule]) }),
  ],
  controllers: [HealthController],
  exports: [PlatformCoreModule],
})
export class PlatformModule {}
