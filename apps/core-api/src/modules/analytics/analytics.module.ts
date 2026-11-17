import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { AiUsageController } from './ai-usage/api/ai-usage.controller.js';
import { AI_USAGE_STORE, AiUsageUseCases } from './ai-usage/application/ai-usage.use-cases.js';
import { AiUsageConsumer } from './ai-usage/consumers/ai-usage.consumer.js';
import { DrizzleAiUsageStore } from './ai-usage/infra/drizzle-ai-usage.store.js';

/**
 * Module analytics. Chủ: Trang (backup Thành). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts.
 */
@Module({
  controllers: [AiUsageController],
  providers: [
    { provide: AI_USAGE_STORE, inject: [DB_POOLS], useFactory: (pools: DbPools) => new DrizzleAiUsageStore(createDb(pools.analytics)) },
    AiUsageUseCases,
    AiUsageConsumer,
  ],
})
export class AnalyticsModule {}
