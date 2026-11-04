import { Module } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { createDb, type Db } from '@tripflix/db';
import { RedisStreamsEventBus, STREAMS } from '@tripflix/event-bus';
import { Redis } from 'ioredis';
import { DB_POOLS, REDIS, type DbPools } from '../../platform/tokens.js';
import { ContentFacade } from './content.facade.js';
import {
  AdminPostsController,
  BookmarksController,
  CommentsController,
  PostsController,
  ReactionsController,
} from './social/api/index.js';
import {
  AddCommentUseCase,
  AdminModeratePostUseCase,
  BookmarkPostUseCase,
  COMMERCE_SERVICE_PORT,
  CreateDraftUseCase,
  DeleteCommentUseCase,
  DeletePostUseCase,
  EditCommentUseCase,
  EVENT_PUBLISHER_PORT,
  GetPostDetailUseCase,
  GetPostStatsUseCase,
  ListBookmarksUseCase,
  ListCommentsUseCase,
  ListPostsUseCase,
  ListUserPostsUseCase,
  PublishPostUseCase,
  SetReactionUseCase,
  TrackShareUseCase,
  UpdatePostUseCase,
  type CommerceServicePort,
  type EventPublisherPort,
} from './social/application/index.js';
import {
  BookmarkRepository,
  CommentRepository,
  ModerationActionRepository,
  PostRepository,
  ReactionRepository,
} from './social/infra/index.js';

export const CONTENT_DB = Symbol('CONTENT_DB');

/**
 * Module content. Quản lý Posts, Comments, Reactions, Bookmarks, Shares và Admin Moderation.
 * Module khác chỉ dùng những gì được export trong index.ts (ContentFacade).
 */
@Module({
  controllers: [
    PostsController,
    ReactionsController,
    CommentsController,
    BookmarksController,
    AdminPostsController,
  ],
  providers: [
    // 1. Drizzle DB Client cho schema 'content'
    {
      provide: CONTENT_DB,
      inject: [DB_POOLS],
      useFactory: (pools: DbPools): Db => createDb(pools.content),
    },

    // 2. Infra Repositories
    {
      provide: PostRepository,
      inject: [CONTENT_DB],
      useFactory: (db: Db) => new PostRepository(db),
    },
    {
      provide: CommentRepository,
      inject: [CONTENT_DB],
      useFactory: (db: Db) => new CommentRepository(db),
    },
    {
      provide: ReactionRepository,
      inject: [CONTENT_DB],
      useFactory: (db: Db) => new ReactionRepository(db),
    },
    {
      provide: BookmarkRepository,
      inject: [CONTENT_DB],
      useFactory: (db: Db) => new BookmarkRepository(db),
    },
    {
      provide: ModerationActionRepository,
      inject: [CONTENT_DB],
      useFactory: (db: Db) => new ModerationActionRepository(db),
    },

    // 3. Ports Adapters (Event Bus & Commerce Service)
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
        async verifyCompletedBooking(bookingId: string, userId: string): Promise<boolean> {
          return Boolean(bookingId.trim() && userId.trim());
        },
      }),
    },

    // 4. Application Use Cases
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
      inject: [PostRepository, EVENT_PUBLISHER_PORT, COMMERCE_SERVICE_PORT],
      useFactory: (
        postRepo: PostRepository,
        eventPublisher: EventPublisherPort,
        commerceService: CommerceServicePort,
      ) => new PublishPostUseCase(postRepo, eventPublisher, commerceService),
    },
    {
      provide: DeletePostUseCase,
      inject: [PostRepository, EVENT_PUBLISHER_PORT],
      useFactory: (postRepo: PostRepository, eventPublisher: EventPublisherPort) =>
        new DeletePostUseCase(postRepo, eventPublisher),
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
      inject: [PostRepository, ReactionRepository, EVENT_PUBLISHER_PORT],
      useFactory: (
        postRepo: PostRepository,
        reactionRepo: ReactionRepository,
        eventPublisher: EventPublisherPort,
      ) => new SetReactionUseCase(postRepo, reactionRepo, eventPublisher),
    },
    {
      provide: GetPostStatsUseCase,
      inject: [PostRepository],
      useFactory: (postRepo: PostRepository) => new GetPostStatsUseCase(postRepo),
    },
    {
      provide: AddCommentUseCase,
      inject: [PostRepository, CommentRepository, EVENT_PUBLISHER_PORT],
      useFactory: (
        postRepo: PostRepository,
        commentRepo: CommentRepository,
        eventPublisher: EventPublisherPort,
      ) => new AddCommentUseCase(postRepo, commentRepo, eventPublisher),
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
      inject: [PostRepository, EVENT_PUBLISHER_PORT],
      useFactory: (postRepo: PostRepository, eventPublisher: EventPublisherPort) =>
        new TrackShareUseCase(postRepo, eventPublisher),
    },
    {
      provide: AdminModeratePostUseCase,
      inject: [PostRepository, ModerationActionRepository, EVENT_PUBLISHER_PORT],
      useFactory: (
        postRepo: PostRepository,
        modRepo: ModerationActionRepository,
        eventPublisher: EventPublisherPort,
      ) => new AdminModeratePostUseCase(postRepo, modRepo, eventPublisher),
    },

    // 5. Facade cho các module khác
    ContentFacade,
  ],
  exports: [ContentFacade],
})
export class ContentModule {}
