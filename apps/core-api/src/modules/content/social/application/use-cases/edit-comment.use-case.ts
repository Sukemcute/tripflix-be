import { ConflictException } from '@nestjs/common';
import type { ContentGatePort } from '../ports/content-gate.port.js';
import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord, PostVisibility } from '../../../db/schema/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { matchesCommentKeywords } from '../../domain/comment-filter.js';
import { formatReplyExcerpt, isPublicReplyTarget } from '../common/reply-excerpt.js';
import { validateMentionedUsers } from '../common/validate-mentioned-users.js';
import type { CommentMention } from '../../domain/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

export interface EditCommentCommand {
  commentId: string;
  userId: string;
  body: string;
  mentions?: CommentMention[];
}

export class EditCommentUseCase {
  constructor(
    private readonly commentRepository: CommentRepository,
    private readonly outbox: ContentOutbox,
    private readonly postRepository?: PostRepository,
    private readonly gate?: ContentGatePort,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(
    command: EditCommentCommand,
  ): Promise<CommentRecord & { replyToCommentId: string | null; replyToExcerpt: string | null }> {
    const body = Comment.validateBody(command.body);
    const shouldHold = this.gate?.precheck(body).shouldHold ?? false;
    const initial = await this.commentRepository.findById(command.commentId);
    if (!initial || !['visible', 'held'].includes(initial.status) || initial.deletedAt) {
      throw new CommentNotFoundException(command.commentId);
    }
    const comment = new Comment({ ...initial });
    comment.updateBody(command.userId, command.body, command.mentions ?? initial.mentions ?? []);
    await validateMentionedUsers(comment.mentions, this.userDirectory);
    const updated = await this.editInTransaction(
      { ...command, body: comment.body, mentions: comment.mentions }, shouldHold, initial,
    );
    const replyToCommentId = updated.replyToCommentId ?? null;
    let replyToExcerpt: string | null = null;
    if (replyToCommentId && typeof this.commentRepository.findByIds === 'function') {
      const [target] = await this.commentRepository.findByIds(updated.postId, [replyToCommentId]);
      if (isPublicReplyTarget(target, updated.postId)) {
        replyToExcerpt = formatReplyExcerpt(target.body);
      }
    }
    return {
      ...updated,
      replyToCommentId,
      replyToExcerpt,
    };
  }

  @Transactional('content')
  protected async editInTransaction(
    command: EditCommentCommand, shouldHold: boolean, prepared: CommentRecord,
  ): Promise<CommentRecord> {
    let record = await this.commentRepository.findById(command.commentId);
    if (!record || !['visible', 'held'].includes(record.status) || record.deletedAt) {
      throw new CommentNotFoundException(command.commentId);
    }
    if (record.body !== prepared.body || JSON.stringify(record.mentions ?? []) !== JSON.stringify(prepared.mentions ?? []))
      throw new ConflictException('Bình luận vừa thay đổi, vui lòng thử lại');
    let postVisibility: PostVisibility | undefined;
    let matchesCreatorKeywords = false;
    if (this.postRepository) {
      const post = this.postRepository.findByIdForUpdate
        ? await this.postRepository.findByIdForUpdate(record.postId)
        : await this.postRepository.findById(record.postId);
      if (!post || post.status !== 'published' || post.deletedAt)
        throw new CommentNotFoundException(command.commentId);
      postVisibility = post.visibility;
      matchesCreatorKeywords =
        command.userId !== post.authorId && matchesCommentKeywords(command.body, post.commentKeywords ?? []);
    }

    // Khoá theo cùng thứ tự với moderation: bài trước, bình luận sau.
    const locked = this.commentRepository.findByIdForUpdate
      ? await this.commentRepository.findByIdForUpdate(record.id) : record;
    if (!locked || locked.status !== record.status || locked.body !== record.body || locked.deletedAt ||
      JSON.stringify(locked.mentions ?? []) !== JSON.stringify(record.mentions ?? []))
      throw new ConflictException('Bình luận vừa thay đổi, vui lòng thử lại');
    record = locked;
    const creatorHeld =
      locked.creatorReview === 'pending' || locked.creatorReview === 'rejected' || matchesCreatorKeywords;
    const platformHeld = shouldHold || Boolean(locked.platformHeld);
    const domainComment = new Comment({
      id: record.id,
      postId: record.postId,
      authorId: record.authorId,
      parentCommentId: record.parentCommentId,
      body: record.body,
      mentions: record.mentions ?? [],
      isEdited: record.isEdited,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    });

    domainComment.updateBody(command.userId, command.body, command.mentions);

    shouldHold ||= creatorHeld;
    let heldCount = 0;
    if (shouldHold && record.status === 'visible') {
      if (!this.postRepository) throw new Error('PostRepository is required to hold an edited comment');
      heldCount = await this.commentRepository.holdWithVisibleReplies(record.id, !record.parentCommentId);
    }
    const updated = await this.commentRepository.update(command.commentId, {
      body: domainComment.body,
      mentions: domainComment.mentions,
      isEdited: true,
      ...(platformHeld ? { platformHeld: true } : {}),
      ...(creatorHeld ? { creatorReview: 'pending' as const } : {}),
      ...(shouldHold ? { status: 'held' as const } : {}),
    });

    if (heldCount) await this.postRepository!.incrementCounter(record.postId, 'commentCount', -heldCount);
    await this.outbox.add({
      type: updated.status === 'held' ? 'content.comment.held' : 'content.comment.updated',
      userId: command.userId,
      payload: {
        commentId: updated.id,
        postId: updated.postId,
        authorId: updated.authorId,
        parentCommentId: updated.parentCommentId ?? null,
        ...(postVisibility ? { postVisibility } : {}),
        body: updated.body,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });

    return updated;
  }
}
