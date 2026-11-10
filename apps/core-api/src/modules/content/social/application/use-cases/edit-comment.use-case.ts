import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord } from '../../../db/schema/index.js';
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
  ) {}

  @Transactional('content')
  async execute(command: EditCommentCommand): Promise<CommentRecord> {
    const record = await this.commentRepository.findById(command.commentId);
    if (!record || record.status !== 'visible') {
      throw new CommentNotFoundException(command.commentId);
    }
    if (this.postRepository) {
      const post = await this.postRepository.findById(record.postId);
      if (!post || post.status !== 'published' || post.deletedAt)
        throw new CommentNotFoundException(command.commentId);
    }

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

    const updated = await this.commentRepository.update(command.commentId, {
      body: domainComment.body,
      isEdited: true,
    });

    await this.outbox.add({
      type: 'content.comment.updated',
      userId: command.userId,
      payload: {
        commentId: updated.id,
        postId: updated.postId,
        authorId: updated.authorId,
        parentCommentId: updated.parentCommentId ?? null,
        body: updated.body,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });

    return updated;
  }
}
