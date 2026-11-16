import type { ContentGatePort } from '../ports/content-gate.port.js';
import { assertPrecheckedPost, postGateText } from '../common/content-precheck.js';
import { Transactional } from '@tripflix/db';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { assertPostMediaAllowed } from '../common/post-media.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { PostMediaPort } from '../ports/post-media.port.js';
import type {
  PostRecord,
  PostVisibility,
  TripAttachmentData,
} from '../../../db/schema/index.js';

export interface UpdatePostCommand {
  postId: string;
  userId: string;
  title?: string;
  body?: string;
  hashtags?: string[];
  visibility?: PostVisibility;
  mediaIds?: string[];
  coverMediaId?: string;
  tripAttachment?: TripAttachmentData | null;
}

export class UpdatePostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly outbox?: ContentOutbox,
    private readonly postMedia?: PostMediaPort,
    private readonly gate?: ContentGatePort,
  ) {}

  async execute(command: UpdatePostCommand): Promise<PostRecord> {
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

    // Chủ ảnh phải là tác giả bài; người khác sửa thì domainPost.update chặn trước ở dưới.
    if (command.mediaIds !== undefined && domainPost.isOwnedBy(command.userId)) {
      await assertPostMediaAllowed(this.postMedia, {
        postType: record.postType,
        authorId: record.authorId,
        mediaIds: command.mediaIds,
      });
    }

    domainPost.update(command.userId, {
      title: command.title,
      body: command.body,
      hashtags: command.hashtags,
      visibility: command.visibility,
      mediaIds: command.mediaIds,
      coverMediaId: command.coverMediaId,
      tripAttachment: command.tripAttachment,
    });

    const shouldHold = record.status !== 'draft' && (this.gate?.precheck(postGateText({
      title: domainPost.title, body: domainPost.body, hashtags: domainPost.hashtags,
    })).shouldHold ?? false);
    return this.updateInTransaction(command, record, domainPost, shouldHold);
  }

  @Transactional('content')
  protected async updateInTransaction(
    command: UpdatePostCommand, record: PostRecord, domainPost: Post, shouldHold: boolean,
  ): Promise<PostRecord> {
    const current = this.postRepository.findByIdForUpdate
      ? await this.postRepository.findByIdForUpdate(record.id)
      : await this.postRepository.findById(record.id);
    if (!current) throw new PostNotFoundException(record.id);
    assertPrecheckedPost(current, record);
    const previousStatus = record.status;
    const status = shouldHold && ['published', 'held'].includes(previousStatus) ? 'held' : previousStatus;
    const updated = await this.postRepository.update(command.postId, {
      status,
      title: domainPost.title,
      body: domainPost.body,
      hashtags: domainPost.hashtags,
      visibility: domainPost.visibility,
      mediaIds: domainPost.mediaIds,
      coverMediaId: domainPost.coverMediaId,
      tripAttachment: domainPost.tripAttachment,
      isVerified: domainPost.isVerified,
    });

    // Nếu bài viết đã xuất bản (published), phát sự kiện outbox content.post.updated để Moderation quét lại nội dung
    if (previousStatus === 'published' && this.outbox) {
      await this.outbox.add({
        type: 'content.post.updated',
        userId: command.userId,
        payload: {
          postId: updated.id,
          authorId: updated.authorId,
          title: updated.title,
          body: updated.body,
          hashtags: updated.hashtags,
          visibility: updated.visibility,
          mediaIds: updated.mediaIds,
          coverMediaId: updated.coverMediaId,
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    }

    if (status === 'held' && this.outbox) {
      await this.outbox.add({ type: 'content.post.held', userId: command.userId,
        payload: { postId: updated.id, authorId: updated.authorId } });
    }
    return updated;
  }
}
