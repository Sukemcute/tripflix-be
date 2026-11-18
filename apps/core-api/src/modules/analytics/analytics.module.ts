import { Module } from '@nestjs/common';
import { createDb } from '@tripflix/db';
import { DB_POOLS, type DbPools } from '../../platform/tokens.js';
import { AiUsageController } from './ai-usage/api/ai-usage.controller.js';
import { AI_USAGE_STORE, AiUsageUseCases } from './ai-usage/application/ai-usage.use-cases.js';
import { AiUsageConsumer } from './ai-usage/consumers/ai-usage.consumer.js';
import { DrizzleAiUsageStore } from './ai-usage/infra/drizzle-ai-usage.store.js';
import { USER_ACTIVITY_STORE, UserActivityUseCases } from './user-activity/application/user-activity.use-cases.js';
import { DrizzleUserActivityStore } from './user-activity/infra/drizzle-user-activity.store.js';
import { UserActivityRetentionJob } from './user-activity/jobs/user-activity-retention.job.js';
import { ObservabilityController } from './observability/api/observability.controller.js';
import { ObservabilityService, TELEMETRY_ENV } from './observability/application/observability.service.js';
import { TelemetryEnvSchema } from './observability/infra/telemetry-store.js';

/**
 * Module analytics. Chủ: Trang (backup Thành). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts.
 */
@Module({
  controllers: [AiUsageController, ObservabilityController],
  providers: [
    {
      provide: AI_USAGE_STORE,
      inject: [DB_POOLS],
      useFactory: (pools: DbPools) => new DrizzleAiUsageStore(createDb(pools.analytics)),
    },
    {
      provide: USER_ACTIVITY_STORE,
      inject: [DB_POOLS],
      useFactory: (pools: DbPools) => new DrizzleUserActivityStore(createDb(pools.analytics)),
    },
    AiUsageUseCases,
    UserActivityUseCases,
    UserActivityRetentionJob,
    AiUsageConsumer,
    ObservabilityService,
    { provide: TELEMETRY_ENV, useFactory: () => TelemetryEnvSchema.parse(process.env) },
  ],
  exports: [USER_ACTIVITY_STORE],
})
export class AnalyticsModule {}
