import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/index.js';
import { ContentModule } from '../../content/index.js';
import { AnalyticsModule } from '../analytics.module.js';
import { UserActivityController } from './api/user-activity.controller.js';
import { UserActivityQueries } from './application/user-activity-queries.use-cases.js';

/**
 * Trang hành vi người dùng (TF177). Tách khỏi AnalyticsModule vì cần AccessModule để đọc tên, email;
 * AccessModule đặt cấu hình xác thực toàn cục nên không được kéo vào module analytics.
 * Số liệu hồ sơ (người theo dõi, lượt thích, số bài) đọc qua ContentFacade.
 */
@Module({
  imports: [AnalyticsModule, AccessModule, ContentModule],
  controllers: [UserActivityController],
  providers: [UserActivityQueries],
})
export class UserActivityModule {}
