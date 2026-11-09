import { Module } from '@nestjs/common';
import { buildTransactionHostToken, createDb, type ModuleTransactionHost } from '@tripflix/db';
import { DrizzleIdempotencyStore, IdempotencyModule } from '@tripflix/idempotency';
import { OutboxWriter } from '@tripflix/outbox';
import type { CoreEnv } from '../../../platform/env.js';
import { CORE_ENV, DB_POOLS, type DbPools } from '../../../platform/tokens.js';
import { contentIdempotencyKeys, contentOutboxEvents } from '../db/schema/index.js';
import { MediaFacade } from '../media/media.facade.js';
import { MediaModule } from '../media/media.module.js';
import { AdminModeratePostUseCase } from '../social/application/use-cases/admin-moderate-post.use-case.js';
import { PostRepository } from '../social/infra/post.repository.js';
import { ModerationActionRepository } from '../social/infra/moderation-action.repository.js';
import type { ContentOutbox } from '../social/application/ports/content-outbox.port.js';
import { AdminModerationController, ReportsController } from './api/moderation.controller.js';
import { ChangeVisibilityUseCase } from './application/change-visibility.use-case.js';
import {
  DecideCaseUseCase,
  RecordScreeningUseCase,
  ScreenContentUseCase,
  SubmitReportUseCase,
  type ScreeningConfig,
} from './application/moderation.use-cases.js';
import { ScreeningConsumer } from './consumers/screening.consumer.js';
import { AiModerationClient } from './infra/ai-moderation.client.js';
import { ModerationRepository } from './infra/moderation.repository.js';

const OUTBOX = Symbol('MODERATION_OUTBOX');
const CONFIG = Symbol('MODERATION_CONFIG');
@Module({
  imports: [
    MediaModule,
    IdempotencyModule.forFeature({
      inject: [DB_POOLS],
      useFactory: (pools: DbPools) =>
        new DrizzleIdempotencyStore(createDb(pools.content), contentIdempotencyKeys),
    }),
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [
    {
      provide: ModerationRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (tx: ModuleTransactionHost) => new ModerationRepository(() => tx.tx),
    },
    {
      provide: PostRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (tx: ModuleTransactionHost) => new PostRepository(() => tx.tx),
    },
    {
      provide: ModerationActionRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (tx: ModuleTransactionHost) => new ModerationActionRepository(() => tx.tx),
    },
    {
      provide: OUTBOX,
      inject: [buildTransactionHostToken('content')],
      useFactory: (tx: ModuleTransactionHost) =>
        new OutboxWriter(() => tx.tx, contentOutboxEvents, 'core-api/content'),
    },
    {
      provide: CONFIG,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv): ScreeningConfig => ({
        aiThreshold: env.MODERATION_AI_THRESHOLD ?? 0.8,
        reportThreshold: env.MODERATION_REPORT_THRESHOLD ?? 3,
        allowedDomains: (env.MODERATION_ALLOWED_DOMAINS ?? 'tripflix.vn,maps.google.com,maps.app.goo.gl')
          .split(',')
          .map((domain) => domain.trim())
          .filter(Boolean),
      }),
    },
    {
      provide: AiModerationClient,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv) =>
        new AiModerationClient({
          aiUrl: env.AI_SERVICE_URL,
          coreUrl: env.CORE_API_INTERNAL_URL,
          secret: env.MODERATION_SERVICE_CLIENT_SECRET,
        }),
    },
    {
      provide: AdminModeratePostUseCase,
      inject: [PostRepository, ModerationActionRepository, OUTBOX],
      useFactory: (posts: PostRepository, actions: ModerationActionRepository, outbox: ContentOutbox) =>
        new AdminModeratePostUseCase(posts, actions, outbox),
    },
    {
      provide: ChangeVisibilityUseCase,
      inject: [ModerationRepository, PostRepository, OUTBOX, AdminModeratePostUseCase],
      useFactory: (
        repository: ModerationRepository,
        posts: PostRepository,
        outbox: ContentOutbox,
        moderate: AdminModeratePostUseCase,
      ) => new ChangeVisibilityUseCase(repository, posts, outbox, moderate),
    },
    {
      provide: RecordScreeningUseCase,
      inject: [ModerationRepository, ChangeVisibilityUseCase, CONFIG],
      useFactory: (
        repository: ModerationRepository,
        visibility: ChangeVisibilityUseCase,
        config: ScreeningConfig,
      ) => new RecordScreeningUseCase(repository, visibility, config),
    },
    {
      provide: ScreenContentUseCase,
      inject: [ModerationRepository, AiModerationClient, RecordScreeningUseCase, MediaFacade],
      useFactory: (
        repository: ModerationRepository,
        ai: AiModerationClient,
        record: RecordScreeningUseCase,
        media: MediaFacade,
      ) => new ScreenContentUseCase(repository, ai, record, media),
    },
    {
      provide: SubmitReportUseCase,
      inject: [ModerationRepository, ChangeVisibilityUseCase, OUTBOX, CONFIG],
      useFactory: (
        repository: ModerationRepository,
        visibility: ChangeVisibilityUseCase,
        outbox: ContentOutbox,
        config: ScreeningConfig,
      ) => new SubmitReportUseCase(repository, visibility, outbox, config),
    },
    {
      provide: DecideCaseUseCase,
      inject: [ModerationRepository, ChangeVisibilityUseCase],
      useFactory: (repository: ModerationRepository, visibility: ChangeVisibilityUseCase) =>
        new DecideCaseUseCase(repository, visibility),
    },
    ScreeningConsumer,
  ],
})
export class ModerationModule {}
