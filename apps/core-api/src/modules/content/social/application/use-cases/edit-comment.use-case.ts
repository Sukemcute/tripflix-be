import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { CommentRecord } from '../../../db/schema/index.js';

export interface EditCommentCommand {
  commentId: string;
  userId: string;
  body: string;
}

export class EditCommentUseCase {
  constructor(private readonly commentRepository: CommentRepository) {}

  async execute(command: EditCommentCommand): Promise<CommentRecord> {
    const record = await this.commentRepository.findById(command.commentId);
    if (!record) {
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

    return this.commentRepository.update(command.commentId, {
      body: domainComment.body,
      isEdited: true,
    });
  }
}
