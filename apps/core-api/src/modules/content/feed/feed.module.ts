import { Module } from '@nestjs/common';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import { MediaModule } from '../media/media.module.js';
import { OptionalAuthGuard } from '../social/api/optional-auth.guard.js';
import { FeedController } from './api/feed.controller.js';
import { FeedUseCases } from './application/feed.use-cases.js';
import { FEED_STORE } from './application/ports.js';
import { DrizzleFeedStore } from './infra/drizzle-feed.store.js';

/** Phần con feed của content. Test thay database bằng overrideProvider(FEED_STORE). */
@Module({
  imports: [MediaModule],
  controllers: [FeedController],
  providers: [
    FeedUseCases,
    OptionalAuthGuard,
    {
      provide: FEED_STORE,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new DrizzleFeedStore(() => txHost.tx),
    },
  ],
})
export class FeedModule {}
