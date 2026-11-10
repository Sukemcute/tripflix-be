import { Module } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { buildTransactionHostToken, createDb, type Db, type ModuleTransactionHost } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { OutboxWriter } from '@tripflix/outbox';
import { Redis } from 'ioredis';
import { DB_POOLS, REDIS, type DbPools } from '../../platform/tokens.js';
import { AccessFacade, AccessModule } from '../access/index.js';
import { ContentFacade } from './content.facade.js';
import { contentOutboxEvents } from './db/schema/index.js';
import { FeedModule } from './feed/feed.module.js';
import { MediaModule } from './media/media.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import {
  AdminPostsController,
  BookmarksController,
  CommentsController,
  OptionalAuthGuard,
  PostSummaryController,
  PostsController,
  ReactionsController,
} from './social/api/index.js';
import {
  AddCommentUseCase,
  AdminModeratePostUseCase,
  BookmarkPostUseCase,
  COMMERCE_SERVICE_PORT,
  USER_DIRECTORY_PORT,
  type UserDirectoryPort,
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
  GetPostSummaryUseCase,
  ListAdminPostsUseCase,
  ListBookmarksUseCase,
  ListCommentsUseCase,
  ListPostsUseCase,
  ListUserPostsUseCase,
  PublishPostUseCase,
  SavePostSummaryUseCase,
  SetCommentReactionUseCase,
  SetReactionUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
  type CommerceServicePort,
  type ContentOutbox,
  type EventPublisherPort,
} from './social/application/index.js';
import {
  BookmarkRepository,
  CommentReactionRepository,
  CommentRepository,
  ContentOutboxRelay,
  ModerationActionRepository,
  PostRepository,
  PostSummaryRepository,
  ReactionRepository,
} from './social/infra/index.js';

export const CONTENT_DB = Symbol('CONTENT_DB');
export const CONTENT_EVENT_PRODUCER = 'core-api/content';

/**
 * Module content. Quản lý Media, Posts, Comments, Reactions, Bookmarks, Shares và Admin Moderation.
 * Module khác chỉ dùng những gì được export trong index.ts (ContentFacade).
 */
@Module({
  imports: [MediaModule, FeedModule, AccessModule, ModerationModule],
  controllers: [
    PostsController,
    ReactionsController,
    CommentsController,
    BookmarksController,
    AdminPostsController,
    PostSummaryController,
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
      provide: CommentReactionRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new CommentReactionRepository(() => txHost.tx),
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
    {
      provide: PostSummaryRepository,
      inject: [buildTransactionHostToken('content')],
      useFactory: (txHost: ModuleTransactionHost) => new PostSummaryRepository(() => txHost.tx),
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
      provide: USER_DIRECTORY_PORT,
      inject: [AccessFacade],
      useFactory: (access: AccessFacade): UserDirectoryPort => ({
        getDisplayNames: (userIds) => access.getDisplayNames(userIds),
      }),
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
      inject: [PostRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, outbox: ContentOutbox) =>
        new UpdatePostUseCase(postRepo, outbox),
    },
    {
      provide: PublishPostUseCase,
      inject: [PostRepository, CONTENT_OUTBOX, COMMERCE_SERVICE_PORT],
      useFactory: (postRepo: PostRepository, outbox: ContentOutbox, commerceService: CommerceServicePort) =>
        new PublishPostUseCase(postRepo, outbox, commerceService),
    },
    {
      provide: DeletePostUseCase,
      inject: [PostRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, outbox: ContentOutbox) =>
        new DeletePostUseCase(postRepo, outbox),
    },
    {
      provide: GetPostDetailUseCase,
      inject: [PostRepository, ReactionRepository, BookmarkRepository, USER_DIRECTORY_PORT],
      useFactory: (
        postRepo: PostRepository,
        reactionRepo: ReactionRepository,
        bookmarkRepo: BookmarkRepository,
        userDirectory: UserDirectoryPort,
      ) => new GetPostDetailUseCase(postRepo, reactionRepo, bookmarkRepo, userDirectory),
    },
    {
      provide: ListPostsUseCase,
      inject: [PostRepository, USER_DIRECTORY_PORT],
      useFactory: (postRepo: PostRepository, userDirectory: UserDirectoryPort) =>
        new ListPostsUseCase(postRepo, userDirectory),
    },
    {
      provide: ListUserPostsUseCase,
      inject: [PostRepository, USER_DIRECTORY_PORT],
      useFactory: (postRepo: PostRepository, userDirectory: UserDirectoryPort) =>
        new ListUserPostsUseCase(postRepo, userDirectory),
    },
    {
      provide: SetReactionUseCase,
      inject: [PostRepository, ReactionRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, reactionRepo: ReactionRepository, outbox: ContentOutbox) =>
        new SetReactionUseCase(postRepo, reactionRepo, outbox),
    },
    {
      provide: GetPostStatsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new GetPostStatsUseCase(postRepo),
    },
    {
      provide: AddCommentUseCase,
      inject: [PostRepository, CommentRepository, CONTENT_OUTBOX],
      useFactory: (postRepo: PostRepository, commentRepo: CommentRepository, outbox: ContentOutbox) =>
        new AddCommentUseCase(postRepo, commentRepo, outbox),
    },
    {
      provide: EditCommentUseCase,
      inject: [CommentRepository, CONTENT_OUTBOX, PostRepository],
      useFactory: (commentRepo: CommentRepository, outbox: ContentOutbox, postRepo: PostRepository) =>
        new EditCommentUseCase(commentRepo, outbox, postRepo),
    },
    {
      provide: DeleteCommentUseCase,
      inject: [CommentRepository, PostRepository, CONTENT_OUTBOX],
      useFactory: (commentRepo: CommentRepository, postRepo: PostRepository, outbox: ContentOutbox) =>
        new DeleteCommentUseCase(commentRepo, postRepo, outbox),
    },
    {
      provide: ListCommentsUseCase,
      inject: [PostRepository, CommentRepository, CommentReactionRepository, USER_DIRECTORY_PORT],
      useFactory: (
        postRepo: PostRepository,
        commentRepo: CommentRepository,
        commentReactionRepo: CommentReactionRepository,
        userDirectory: UserDirectoryPort,
      ) => new ListCommentsUseCase(postRepo, commentRepo, commentReactionRepo, userDirectory),
    },
    {
      provide: SetCommentReactionUseCase,
      inject: [CommentRepository, CommentReactionRepository, CONTENT_OUTBOX, PostRepository],
      useFactory: (
        commentRepo: CommentRepository,
        commentReactionRepo: CommentReactionRepository,
        outbox: ContentOutbox,
        postRepo: PostRepository,
      ) => new SetCommentReactionUseCase(commentRepo, commentReactionRepo, outbox, postRepo),
    },
    {
      provide: BookmarkPostUseCase,
      inject: [PostRepository, BookmarkRepository],
      useFactory: (postRepo: PostRepository, bookmarkRepo: BookmarkRepository) =>
        new BookmarkPostUseCase(postRepo, bookmarkRepo),
    },
    {
      provide: ListBookmarksUseCase,
      inject: [BookmarkRepository, PostRepository, USER_DIRECTORY_PORT],
      useFactory: (
        bookmarkRepo: BookmarkRepository,
        postRepo: PostRepository,
        userDirectory: UserDirectoryPort,
      ) => new ListBookmarksUseCase(bookmarkRepo, postRepo, userDirectory),
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
      useFactory: (postRepo: PostRepository, modRepo: ModerationActionRepository, outbox: ContentOutbox) =>
        new AdminModeratePostUseCase(postRepo, modRepo, outbox),
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
      useFactory: (postRepo: PostRepository, modRepo: ModerationActionRepository) =>
        new GetAdminPostDetailUseCase(postRepo, modRepo),
    },
    {
      provide: SavePostSummaryUseCase,
      inject: [PostRepository, PostSummaryRepository],
      useFactory: (postRepo: PostRepository, postSummaryRepo: PostSummaryRepository) =>
        new SavePostSummaryUseCase(postRepo, postSummaryRepo),
    },
    {
      provide: GetPostSummaryUseCase,
      inject: [PostRepository, PostSummaryRepository, CommentRepository],
      useFactory: (
        postRepo: PostRepository,
        postSummaryRepo: PostSummaryRepository,
        commentRepo: CommentRepository,
      ) => new GetPostSummaryUseCase(postRepo, postSummaryRepo, commentRepo),
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
