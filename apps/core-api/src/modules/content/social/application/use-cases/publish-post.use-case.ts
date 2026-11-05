import { Transactional } from '@tripflix/db';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { CommerceServicePort } from '../ports/commerce-service.port.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';

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
    private readonly outbox: ContentOutbox,
    private readonly commerceService?: CommerceServicePort,
  ) {}

  async execute(command: PublishPostCommand): Promise<PublishPostResult> {
    const record = await this.postRepository.findById(command.postId);
    if (!record) {
      throw new PostNotFoundException(command.postId);
    }

    // Kiểm tra dấu "ĐÃ XÁC THỰC" (Verified Badge - F2/FR3) NGOÀI TRANSACTION để không giữ DB connection
    let isVerified = false;
    const bookingId = record.tripAttachment?.bookingId;
    if (bookingId && this.commerceService) {
      isVerified = await this.commerceService.verifyCompletedBooking(bookingId, command.userId);
    }

    return this.publishInTransaction(record, command.userId, isVerified);
  }

  @Transactional('content')
  protected async publishInTransaction(
    record: any,
    userId: string,
    isVerified: boolean,
  ): Promise<PublishPostResult> {
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

    domainPost.publish(userId, { isVerified });

    const publishedAt = domainPost.publishedAt ?? new Date();

    await this.postRepository.update(record.id, {
      status: 'published',
      isVerified: domainPost.isVerified,
      publishedAt,
    });

    const shareUrl = `https://tripflix.vn/posts/${record.id}`;

    // Ghi sự kiện vào content.outbox_events trong cùng transaction DB
    await this.outbox.add({
      type: 'content.post.published',
      userId,
      payload: {
        postId: record.id,
        authorId: userId,
        postType: domainPost.postType,
        title: domainPost.title,
        isVerified: domainPost.isVerified,
        publishedAt: publishedAt.toISOString(),
        shareUrl,
      },
    });

    return {
      id: record.id,
      status: 'published',
      isVerified: domainPost.isVerified,
      publishedAt,
      shareUrl,
    };
  }
}
