import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { createSocialEvent } from '../events/social-events.js';
import type { CommerceServicePort } from '../ports/commerce-service.port.js';
import type { EventPublisherPort } from '../ports/event-publisher.port.js';

export interface PublishPostCommand {
  postId: string;
  userId: string;
}

export interface PublishPostResult {
  id: string;
  status: 'published';
  isVerified: boolean;
  publishedAt: Date;
  shareUrl: string;
}

export class PublishPostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly eventPublisher: EventPublisherPort,
    private readonly commerceService?: CommerceServicePort,
  ) {}

  async execute(command: PublishPostCommand): Promise<PublishPostResult> {
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

    // Kiểm tra dấu "ĐÃ XÁC THỰC" (Verified Badge - F2/FR3)
    let isVerified = false;
    const bookingId = domainPost.tripAttachment?.bookingId;
    if (bookingId && this.commerceService) {
      isVerified = await this.commerceService.verifyCompletedBooking(bookingId, command.userId);
    }

    domainPost.publish(command.userId, { isVerified });

    const publishedAt = domainPost.publishedAt ?? new Date();

    await this.postRepository.update(command.postId, {
      status: 'published',
      isVerified: domainPost.isVerified,
      publishedAt,
    });

    const shareUrl = `https://tripflix.vn/posts/${command.postId}`;

    // Phát sự kiện outbox content.post.published
    await this.eventPublisher.publish(
      createSocialEvent({
        type: 'content.post.published',
        userId: command.userId,
        payload: {
          postId: command.postId,
          authorId: command.userId,
          postType: domainPost.postType,
          title: domainPost.title,
          isVerified: domainPost.isVerified,
          publishedAt: publishedAt.toISOString(),
          shareUrl,
        },
      }),
    );

    return {
      id: command.postId,
      status: 'published',
      isVerified: domainPost.isVerified,
      publishedAt,
      shareUrl,
    };
  }
}
