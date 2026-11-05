import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { createSocialEvent } from '../events/social-events.js';
import type { EventPublisherPort } from '../ports/event-publisher.port.js';

export interface DeletePostCommand {
  postId: string;
  userId: string;
  isSuperAdmin?: boolean;
}

export interface DeletePostResult {
  id: string;
  deleted: true;
}

export class DeletePostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: DeletePostCommand): Promise<DeletePostResult> {
    const record = await this.postRepository.findById(command.postId);
    if (!record) {
      throw new PostNotFoundException(command.postId);
    }

    const domainPost = new Post({
      id: record.id,
      authorId: record.authorId,
      postType: record.postType,
      title: record.title,
      body: record.body,
      hashtags: record.hashtags,
      status: record.status,
      visibility: record.visibility,
      isVerified: record.isVerified,
      mediaIds: record.mediaIds,
      coverMediaId: record.coverMediaId ?? undefined,
      tripAttachment: record.tripAttachment,
      reactionCounts: record.reactionCounts,
      reactionTotal: record.reactionTotal,
      commentCount: record.commentCount,
      shareCount: record.shareCount,
      bookmarkCount: record.bookmarkCount,
      publishedAt: record.publishedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    });

    domainPost.softDelete(command.userId, command.isSuperAdmin);

    await this.postRepository.softDelete(command.postId);

    // Ghi sự kiện outbox content.post.deleted để Discovery và Feed xóa khỏi index
    await this.eventPublisher.publish(
      createSocialEvent({
        type: 'content.post.deleted',
        userId: command.userId,
        payload: {
          postId: command.postId,
          authorId: record.authorId,
          deletedAt: new Date().toISOString(),
        },
      }),
    );

    return {
      id: command.postId,
      deleted: true,
    };
  }
}
