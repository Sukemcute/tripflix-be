import { Module } from '@nestjs/common';
import { RedisStreamsEventBus } from '@tripflix/event-bus';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import { AccessModule } from '../../access/index.js';
import { MediaModule } from '../media/media.module.js';
import { OptionalAuthGuard } from '../social/api/optional-auth.guard.js';
import { FeedController } from './api/feed.controller.js';
import { FeedEventsController } from './api/feed-events.controller.js';
import { FEED_EVENT_BUS, FeedEventsUseCases } from './application/feed-events.use-cases.js';
import { FeedUseCases } from './application/feed.use-cases.js';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../platform/tokens.js';
import { FEED_PAGE_CACHE, FEED_STORE } from './application/ports.js';
import { DrizzleFeedStore } from './infra/drizzle-feed.store.js';
import { FeedFacade } from './feed.facade.js';
import { RedisFeedPageCache } from './infra/redis-feed-page-cache.js';

/** stream:app-events nhiều sự kiện nhỏ, analytics đã giữ bản lâu dài, nên giữ ngắn hơn stream nghiệp vụ (100.000). */
const APP_EVENTS_MAX_LEN = 50_000;

/** Phần con feed của content. Test thay database bằng overrideProvider(FEED_STORE), bus bằng overrideProvider(FEED_EVENT_BUS). */
@Module({
  imports: [MediaModule, AccessModule],
  controllers: [FeedController, FeedEventsController],
  providers: [
    FeedUseCases,
    FeedEventsUseCases,
    FeedFacade,
    OptionalAuthGuard,
    {
      provide: FEED_STORE,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new DrizzleFeedStore(() => txHost.tx),
    },
    { provide: FEED_PAGE_CACHE, inject: [REDIS], useFactory: (redis: Redis) => new RedisFeedPageCache(redis) },
    {
      provide: FEED_EVENT_BUS,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisStreamsEventBus(redis, APP_EVENTS_MAX_LEN),
    },
  ],
  exports: [FeedFacade],
})
export class FeedModule {}
