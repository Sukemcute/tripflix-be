import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/index.js';
import { AnalyticsModule } from '../analytics.module.js';
import { AiInsightsController } from './api/ai-insights.controller.js';
import { AiInsightsQueries } from './application/ai-insights-queries.use-cases.js';

/**
 * Chi phí AI theo thời gian, người dùng và trace từng lượt chat (SCRUM-179). Tách khỏi AnalyticsModule vì cần AccessModule
 * để đọc tên, email; AccessModule đặt cấu hình xác thực toàn cục nên không được kéo vào module analytics.
 */
@Module({
  imports: [AnalyticsModule, AccessModule],
  controllers: [AiInsightsController],
  providers: [AiInsightsQueries],
})
export class AiInsightsModule {}
