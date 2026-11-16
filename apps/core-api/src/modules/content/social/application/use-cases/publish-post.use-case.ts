import type { PostRecord } from '../../../db/schema/index.js';
import type { ContentGatePort } from '../ports/content-gate.port.js';
import { assertPrecheckedPost, postGateText } from '../common/content-precheck.js';
import { Transactional } from '@tripflix/db';
import { InvalidPostStatusTransitionException, Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { assertPostMediaAllowed } from '../common/post-media.js';
import { PostShareLinks } from '../post-share-links.js';
import type { CommerceServicePort } from '../ports/commerce-service.port.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { PostMediaPort } from '../ports/post-media.port.js';

export interface PublishPostCommand {
  postId: string;
  userId: string;
}

export interface PublishPostResult {
  id: string;
  status: 'published' | 'held';
  isVerified: boolean;
  publishedAt: Date | null;
  shareUrl: string;
}

export class PublishPostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly outbox: ContentOutbox,
    private readonly commerceService?: CommerceServicePort,
    private readonly shareLinks: PostShareLinks = new PostShareLinks(),
    private readonly postMedia?: PostMediaPort,
    private readonly gate?: ContentGatePort,
  ) {}

  async execute(command: PublishPostCommand): Promise<PublishPostResult> {
    const record = await this.postRepository.findById(command.postId);
    if (!record) {
      throw new PostNotFoundException(command.postId);
    }

    // Chặn cả bản nháp cũ đã lỡ gắn video vào bài viết, hoặc ảnh vào Reels, trước khi có quy tắc tách bạch.
    await assertPostMediaAllowed(this.postMedia, {
      postType: record.postType,
      authorId: record.authorId,
      mediaIds: record.mediaIds,
    });

    // Kiểm tra dấu "ĐÃ XÁC THỰC" (Verified Badge - F2/FR3) NGOÀI TRANSACTION để không giữ DB connection
    let isVerified = false;
    const bookingId = record.tripAttachment?.bookingId;
    if (bookingId && this.commerceService) {
      isVerified = await this.commerceService.verifyCompletedBooking(bookingId, command.userId);
    }

    const shouldHold = this.gate?.precheck(postGateText(record)).shouldHold ?? false;
    return this.publishInTransaction(record, command.userId, isVerified, shouldHold);
  }

  @Transactional('content')
  protected async publishInTransaction(
    record: PostRecord,
    userId: string,
    isVerified: boolean,
    shouldHold: boolean,
  ): Promise<PublishPostResult> {
    const current = this.postRepository.findByIdForUpdate
      ? await this.postRepository.findByIdForUpdate(record.id)
      : await this.postRepository.findById(record.id);
    if (!current) throw new PostNotFoundException(record.id);
    if (current.status !== 'draft') {
      throw new InvalidPostStatusTransitionException(current.status, 'published');
    }
    assertPrecheckedPost(current, record);

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

    const publishedAt = shouldHold ? null : domainPost.publishedAt ?? new Date();
    const status = shouldHold ? 'held' : 'published';

    await this.postRepository.update(record.id, {
      status,
      isVerified: domainPost.isVerified,
      publishedAt,
    });

    const shareUrl = this.shareLinks.buildUrl(record.id, domainPost.postType);

    // Ghi sự kiện vào content.outbox_events trong cùng transaction DB
    await this.outbox.add({
      type: shouldHold ? 'content.post.held' : 'content.post.published',
      userId,
      payload: {
        postId: record.id,
        authorId: userId,
        postType: domainPost.postType,
        title: domainPost.title,
        isVerified: domainPost.isVerified,
        publishedAt: publishedAt?.toISOString() ?? null,
        shareUrl,
      },
    });

    return {
      id: record.id,
      status,
      isVerified: domainPost.isVerified,
      publishedAt,
      shareUrl,
    };
  }
}
