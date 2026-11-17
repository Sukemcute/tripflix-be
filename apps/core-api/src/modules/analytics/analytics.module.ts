import { Module } from '@nestjs/common';
import { ObservabilityController } from './observability/api/observability.controller.js';
import { ObservabilityService, TELEMETRY_ENV } from './observability/application/observability.service.js';
import { TelemetryEnvSchema } from './observability/infra/telemetry-store.js';

/**
 * Module analytics. Chủ: Trang (backup Thành). Xem README.md cùng thư mục.
 * Module khác chỉ dùng những gì được export trong index.ts.
 */
@Module({
  controllers: [ObservabilityController],
  providers: [
    ObservabilityService,
    { provide: TELEMETRY_ENV, useFactory: () => TelemetryEnvSchema.parse(process.env) },
  ],
})
export class AnalyticsModule {}
