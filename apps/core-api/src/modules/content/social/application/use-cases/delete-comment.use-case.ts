import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';

export interface DeleteCommentCommand {
  commentId: string;
  userId: string;
  isSuperAdmin?: boolean;
}

export interface DeleteCommentResult {
  id: string;
  deleted: true;
}

export class DeleteCommentUseCase {
  constructor(
    private readonly commentRepository: CommentRepository,
    private readonly postRepository: PostRepository,
    private readonly outbox: ContentOutbox,
  ) {}

  @Transactional('content')
  async execute(command: DeleteCommentCommand): Promise<DeleteCommentResult> {
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

    domainComment.softDelete(command.userId, command.isSuperAdmin);

    await this.commentRepository.softDelete(command.commentId);

    // Giảm bộ đếm comment của bài viết
    await this.postRepository.incrementCounter(record.postId, 'commentCount', -1);

    // Ghi sự kiện outbox content.comment.deleted trong cùng transaction DB (phục vụ AI worker tóm tắt lại)
    await this.outbox.add({
      type: 'content.comment.deleted',
      userId: command.userId,
      payload: {
        commentId: record.id,
        postId: record.postId,
        authorId: record.authorId,
        parentCommentId: record.parentCommentId ?? null,
        deletedBy: command.userId,
        isSuperAdmin: command.isSuperAdmin ?? false,
        deletedAt: new Date().toISOString(),
      },
    });

    return {
      id: command.commentId,
      deleted: true,
    };
  }
}
