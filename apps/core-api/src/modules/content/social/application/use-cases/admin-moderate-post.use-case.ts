import { Post, PostNotFoundException } from '../../domain/index.js';
import { ModerationActionRepository } from '../../infra/moderation-action.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import { createSocialEvent } from '../events/social-events.js';
import type { EventPublisherPort } from '../ports/event-publisher.port.js';
import type {
  ModerationActionRecord,
  ModerationActionType,
  PostStatus,
} from '../../../db/schema/index.js';

export interface AdminModeratePostCommand {
  postId: string;
  moderatorId: string;
  action: ModerationActionType;
  reasonCode: string;
  reasonDetail?: string;
  reportIds?: string[];
}

export interface AdminModeratePostResult {
  actionId: string;
  postId: string;
  previousStatus: PostStatus;
  postStatus: PostStatus;
  moderatorId: string;
  createdAt: Date;
}

export class AdminModeratePostUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly moderationActionRepository: ModerationActionRepository,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: AdminModeratePostCommand): Promise<AdminModeratePostResult> {
    const record = await this.postRepository.findById(command.postId);
    if (!record) {
      throw new PostNotFoundException(command.postId);
    }

    const previousStatus = record.status;

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

    domainPost.moderate(command.action);
    const newStatus = domainPost.status;

    await this.postRepository.update(command.postId, {
      status: newStatus,
    });

    const actionRecord = await this.moderationActionRepository.create({
      postId: command.postId,
      moderatorId: command.moderatorId,
      action: command.action,
      previousStatus,
      postStatus: newStatus,
      reasonCode: command.reasonCode,
      reasonDetail: command.reasonDetail,
      reportIds: command.reportIds ?? [],
    });

    // Phát sự kiện outbox content.post.moderated để Feed và Discovery loại bỏ/cập nhật <= 3s
    await this.eventPublisher.publish(
      createSocialEvent({
        type: 'content.post.moderated',
        userId: command.moderatorId,
        payload: {
          actionId: actionRecord.id,
          postId: command.postId,
          previousStatus,
          postStatus: newStatus,
          action: command.action,
          reasonCode: command.reasonCode,
          moderatorId: command.moderatorId,
        },
      }),
    );

    return {
      actionId: actionRecord.id,
      postId: command.postId,
      previousStatus,
      postStatus: newStatus,
      moderatorId: command.moderatorId,
      createdAt: actionRecord.createdAt,
    };
  }
}
