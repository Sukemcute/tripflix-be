import { Module } from '@nestjs/common';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import { AccessModule } from '../../access/index.js';
import { MediaModule } from '../media/media.module.js';
import { OptionalAuthGuard } from '../social/api/optional-auth.guard.js';
import { FeedController } from './api/feed.controller.js';
import { FeedUseCases } from './application/feed.use-cases.js';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../platform/tokens.js';
import { FEED_PAGE_CACHE, FEED_STORE } from './application/ports.js';
import { DrizzleFeedStore } from './infra/drizzle-feed.store.js';
import { RedisFeedPageCache } from './infra/redis-feed-page-cache.js';

/** Phần con feed của content. Test thay database bằng overrideProvider(FEED_STORE). */
@Module({
  imports: [MediaModule, AccessModule],
  controllers: [FeedController],
  providers: [
    FeedUseCases,
    OptionalAuthGuard,
    {
      provide: FEED_STORE,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new DrizzleFeedStore(() => txHost.tx),
    },
    { provide: FEED_PAGE_CACHE, inject: [REDIS], useFactory: (redis: Redis) => new RedisFeedPageCache(redis) },
  ],
})
export class FeedModule {}
