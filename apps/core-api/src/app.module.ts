import { Module } from '@nestjs/common';
import { loggerModule } from '@tripflix/observability';
import { AccessModule } from './modules/access/index.js';
import { AnalyticsModule } from './modules/analytics/index.js';
import { CommerceModule } from './modules/commerce/index.js';
import { ContentModule } from './modules/content/index.js';
import { DiscoveryModule } from './modules/discovery/index.js';
import { PlatformModule } from './platform/platform.module.js';

@Module({
  imports: [
    loggerModule({
      service: 'core-api',
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: process.env.NODE_ENV !== 'production',
    }),
    PlatformModule,
    AccessModule,
    ContentModule,
    DiscoveryModule,
    CommerceModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
