import { Transactional } from '@tripflix/db';
import {
  contentVersion,
  postEvidence,
  MODERATION_POLICY_VERSION,
} from '../../../moderation/domain/content-version.js';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { ModerationActionRepository } from '../../infra/moderation-action.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { ModerationActionType, PostStatus } from '../../../db/schema/index.js';

export interface AdminModeratePostCommand {
  postId: string;
  moderatorId: string;
  action: ModerationActionType;
  reasonCode: string;
  reasonDetail?: string;
  reportIds?: string[];
  actorType?: 'staff' | 'system';
  caseId?: string;
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
    private readonly outbox: ContentOutbox,
  ) {}

  @Transactional('content')
  async execute(command: AdminModeratePostCommand): Promise<AdminModeratePostResult> {
    const record = await this.postRepository.findByIdForUpdate(command.postId);
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

    const updatedPost = await this.postRepository.update(command.postId, {
      status: newStatus,
    });

    const actionRecord = await this.moderationActionRepository.create({
      postId: command.postId,
      moderatorId: command.moderatorId,
      action: command.actorType === 'system' && command.action === 'hide' ? 'auto_hide' : command.action,
      previousStatus,
      postStatus: newStatus,
      reasonCode: command.reasonCode,
      reasonDetail: command.reasonDetail,
      contentVersion: contentVersion(
        postEvidence(updatedPost).text,
        updatedPost.coverMediaId,
        updatedPost.mediaIds,
      ),
      policyVersion: MODERATION_POLICY_VERSION,
      evidenceSnapshot: postEvidence(updatedPost),
      reportIds: command.reportIds ?? [],
      actorType: command.actorType ?? 'staff',
      caseId: command.caseId,
    });

    // Ghi sự kiện outbox content.post.moderated trong cùng transaction DB
    await this.outbox.add({
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
    });

    if (previousStatus !== newStatus && ['hidden', 'removed', 'published'].includes(newStatus)) {
      await this.outbox.add({
        type: newStatus === 'published' ? 'content.post.restored' : 'content.post.hidden',
        userId: command.moderatorId,
        payload: {
          postId: record.id,
          authorId: record.authorId,
          previousStatus,
          postStatus: newStatus,
          actionId: actionRecord.id,
          reasonCode: command.reasonCode,
          hiddenAt: actionRecord.createdAt.toISOString(),
        },
      });
    }

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
