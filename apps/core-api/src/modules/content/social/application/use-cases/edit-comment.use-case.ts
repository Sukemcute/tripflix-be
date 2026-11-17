import { ConflictException } from '@nestjs/common';
import type { ContentGatePort } from '../ports/content-gate.port.js';
import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord, PostVisibility } from '../../../db/schema/index.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface EditCommentCommand {
  commentId: string;
  userId: string;
  body: string;
}

export class EditCommentUseCase {
  constructor(
    private readonly commentRepository: CommentRepository,
    private readonly outbox: ContentOutbox,
    private readonly postRepository?: PostRepository,
    private readonly gate?: ContentGatePort,
  ) {}

  async execute(command: EditCommentCommand): Promise<CommentRecord> {
    const body = Comment.validateBody(command.body);
    const shouldHold = this.gate?.precheck(body).shouldHold ?? false;
    return this.editInTransaction({ ...command, body }, shouldHold);
  }

  @Transactional('content')
  protected async editInTransaction(command: EditCommentCommand, shouldHold: boolean): Promise<CommentRecord> {
    let record = await this.commentRepository.findById(command.commentId);
    if (!record || !['visible', 'held'].includes(record.status) || record.deletedAt) {
      throw new CommentNotFoundException(command.commentId);
    }
    let postVisibility: PostVisibility | undefined;
    if (this.postRepository) {
      const post = this.postRepository.findByIdForUpdate
        ? await this.postRepository.findByIdForUpdate(record.postId)
        : await this.postRepository.findById(record.postId);
      if (!post || post.status !== 'published' || post.deletedAt)
        throw new CommentNotFoundException(command.commentId);
      postVisibility = post.visibility;
    }

    // Khoá theo cùng thứ tự với moderation: bài trước, bình luận sau.
    const locked = this.commentRepository.findByIdForUpdate
      ? await this.commentRepository.findByIdForUpdate(record.id) : record;
    if (!locked || locked.status !== record.status || locked.body !== record.body || locked.deletedAt)
      throw new ConflictException('Bình luận vừa thay đổi, vui lòng thử lại');
    record = locked;
    const domainComment = new Comment({
      id: record.id,
      postId: record.postId,
      authorId: record.authorId,
      parentCommentId: record.parentCommentId,
      body: record.body,
      isEdited: record.isEdited,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    });

    domainComment.updateBody(command.userId, command.body);

    let heldCount = 0;
    if (shouldHold && record.status === 'visible') {
      if (!this.postRepository) throw new Error('PostRepository is required to hold an edited comment');
      heldCount = await this.commentRepository.holdWithVisibleReplies(record.id, !record.parentCommentId);
    }
    const updated = await this.commentRepository.update(command.commentId, {
      body: domainComment.body,
      isEdited: true,
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
