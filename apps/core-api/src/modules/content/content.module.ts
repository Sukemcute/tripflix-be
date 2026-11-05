import { Module } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { buildTransactionHostToken, createDb, type Db, type ModuleTransactionHost } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { OutboxWriter } from '@tripflix/outbox';
import { Redis } from 'ioredis';
import { DB_POOLS, REDIS, type DbPools } from '../../platform/tokens.js';
import { ContentFacade } from './content.facade.js';
import { contentOutboxEvents } from './db/schema/index.js';
import { MediaModule } from './media/media.module.js';
import {
  AdminPostsController,
  BookmarksController,
  CommentsController,
  OptionalAuthGuard,
  PostsController,
  ReactionsController,
} from './social/api/index.js';
import {
  AddCommentUseCase,
  AdminModeratePostUseCase,
  BookmarkPostUseCase,
  COMMERCE_SERVICE_PORT,
  CONTENT_OUTBOX,
  CreateDraftUseCase,
  DeleteCommentUseCase,
  DeletePostUseCase,
  EditCommentUseCase,
  EVENT_PUBLISHER_PORT,
  GetAdminPostDetailUseCase,
  GetMyReactionUseCase,
  GetPostDetailUseCase,
  GetPostStatsUseCase,
  ListAdminPostsUseCase,
  ListBookmarksUseCase,
  ListCommentsUseCase,
  ListPostsUseCase,
  ListUserPostsUseCase,
  PublishPostUseCase,
  SetReactionUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
  type CommerceServicePort,
  type ContentOutbox,
  type EventPublisherPort,
} from './social/application/index.js';
import {
  BookmarkRepository,
  CommentRepository,
  ContentOutboxRelay,
  ModerationActionRepository,
  PostRepository,
  ReactionRepository,
} from './social/infra/index.js';

export const CONTENT_DB = Symbol('CONTENT_DB');
export const CONTENT_EVENT_PRODUCER = 'core-api/content';

/**
 * Module content. Quản lý Media, Posts, Comments, Reactions, Bookmarks, Shares và Admin Moderation.
 * Module khác chỉ dùng những gì được export trong index.ts (ContentFacade).
 */
@Module({
  imports: [MediaModule],
  controllers: [
    PostsController,
    ReactionsController,
    CommentsController,
    BookmarksController,
    AdminPostsController,
  ],
  providers: [
    // 1. Drizzle DB Client cho schema 'content' (kết nối trực tiếp khi không ở trong transaction)
    {
      provide: CONTENT_DB,
      inject: [DB_POOLS],
      useFactory: (pools: DbPools): Db => createDb(pools.content),
    },

    // 2. Infra Repositories (sử dụng txHost.tx để tự động tham gia @Transactional('content'))
    {
      provide: PostRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new PostRepository(() => txHost.tx),
    },
    {
      provide: CommentRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new CommentRepository(() => txHost.tx),
    },
    {
      provide: ReactionRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new ReactionRepository(() => txHost.tx),
    },
    {
      provide: BookmarkRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new BookmarkRepository(() => txHost.tx),
    },
    {
      provide: ModerationActionRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new ModerationActionRepository(() => txHost.tx),
    },

    // 3. Transactional Outbox Writer (ghi vào content.outbox_events trong transaction đang mở)
    {
      provide: CONTENT_OUTBOX,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost): ContentOutbox =>
        new OutboxWriter(() => txHost.tx, contentOutboxEvents, CONTENT_EVENT_PRODUCER),
    },

    // 4. Ports Adapters (Event Bus & Commerce Service)
    {
      provide: EVENT_PUBLISHER_PORT,
      inject: [REDIS],
      useFactory: (redis: Redis): EventPublisherPort => {
        const bus = new RedisStreamsEventBus(redis);
        return {
          async publish(event: EventEnvelope): Promise<void> {
            await bus.publish(STREAMS.content, event);
          },
        };
      },
    },
    {
      provide: COMMERCE_SERVICE_PORT,
      useFactory: (): CommerceServicePort => ({
        async verifyCompletedBooking(): Promise<boolean> {
          // Mặc định trả về false khi chưa tích hợp với module Commerce thật (chưa xác thực)
          return false;
        },
      }),
    },

    // 5. Application Use Cases
    {
      provide: CreateDraftUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new CreateDraftUseCase(postRepo),
    },
    {
      provide: UpdatePostUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new UpdatePostUseCase(postRepo),
    },
    {
      provide: PublishPostUseCase,
      inject: [PostRepository, CONTENT_OUTBOX, COMMERCE_SERVICE_PORT],
      useFactory: (
        postRepo: PostRepository,
        outbox: ContentOutbox,
        commerceService: CommerceServicePort,
      ) => new PublishPostUseCase(postRepo, outbox, commerceService),
    },
    {
      provide: DeletePostUseCase,
      inject: [PostRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, outbox: ContentOutbox) =>
        new DeletePostUseCase(postRepo, outbox),
    },
    {
      provide: GetPostDetailUseCase,
      inject: [PostRepository, ReactionRepository, BookmarkRepository],
      useFactory: (
        postRepo: PostRepository,
        reactionRepo: ReactionRepository,
        bookmarkRepo: BookmarkRepository,
      ) => new GetPostDetailUseCase(postRepo, reactionRepo, bookmarkRepo),
    },
    {
      provide: ListPostsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new ListPostsUseCase(postRepo),
    },
    {
      provide: ListUserPostsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new ListUserPostsUseCase(postRepo),
    },
    {
      provide: SetReactionUseCase,
      inject: [PostRepository, ReactionRepository, CONTENT_OUTBOX],
      useFactory: (
        postRepo: PostRepository,
        reactionRepo: ReactionRepository,
        outbox: ContentOutbox,
      ) => new SetReactionUseCase(postRepo, reactionRepo, outbox),
    },
    {
      provide: GetPostStatsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new GetPostStatsUseCase(postRepo),
    },
    {
      provide: AddCommentUseCase,
      inject: [PostRepository, CommentRepository, CONTENT_OUTBOX],
      useFactory: (
        postRepo: PostRepository,
        commentRepo: CommentRepository,
        outbox: ContentOutbox,
      ) => new AddCommentUseCase(postRepo, commentRepo, outbox),
    },
    {
      provide: EditCommentUseCase,
      inject: [CommentRepository],
      useFactory: (commentRepo: CommentRepository) => new EditCommentUseCase(commentRepo),
    },
    {
      provide: DeleteCommentUseCase,
      inject: [CommentRepository, PostRepository],
      useFactory: (
        commentRepo: CommentRepository,
        postRepo: PostRepository,
      ) => new DeleteCommentUseCase(commentRepo, postRepo),
    },
    {
      provide: ListCommentsUseCase,
      inject: [PostRepository, CommentRepository],
      useFactory: (postRepo: PostRepository, commentRepo: CommentRepository) =>
        new ListCommentsUseCase(postRepo, commentRepo),
    },
    {
      provide: BookmarkPostUseCase,
      inject: [PostRepository, BookmarkRepository],
      useFactory: (
        postRepo: PostRepository,
        bookmarkRepo: BookmarkRepository,
      ) => new BookmarkPostUseCase(postRepo, bookmarkRepo),
    },
    {
      provide: ListBookmarksUseCase,
      inject: [BookmarkRepository, PostRepository],
      useFactory: (bookmarkRepo: BookmarkRepository, postRepo: PostRepository) =>
        new ListBookmarksUseCase(bookmarkRepo, postRepo),
    },
    {
      provide: TrackShareUseCase,
      inject: [PostRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, outbox: ContentOutbox) =>
        new TrackShareUseCase(postRepo, outbox),
    },
    {
      provide: AdminModeratePostUseCase,
      inject: [PostRepository, ModerationActionRepository, CONTENT_OUTBOX],
      useFactory: (
        postRepo: PostRepository,
        modRepo: ModerationActionRepository,
        outbox: ContentOutbox,
      ) => new AdminModeratePostUseCase(postRepo, modRepo, outbox),
    },
    {
      provide: GetMyReactionUseCase,
      inject: [ReactionRepository],
      useFactory: (reactionRepo: ReactionRepository) => new GetMyReactionUseCase(reactionRepo),
    },
    {
      provide: ListAdminPostsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new ListAdminPostsUseCase(postRepo),
    },
    {
      provide: GetAdminPostDetailUseCase,
      inject: [PostRepository, ModerationActionRepository],
      useFactory: (
        postRepo: PostRepository,
        modRepo: ModerationActionRepository,
      ) => new GetAdminPostDetailUseCase(postRepo, modRepo),
    },

    // 6. Guard cho optional authentication
    OptionalAuthGuard,

    // 7. Background Outbox Relay worker
    ContentOutboxRelay,

    // 8. Facade cho các module khác
    ContentFacade,
  ],
  exports: [ContentFacade, MediaModule],
})
export class ContentModule {}
