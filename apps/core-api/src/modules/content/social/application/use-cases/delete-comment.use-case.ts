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
    // Cùng thứ tự khóa với add/hide để không tạo phản hồi mới trong lúc cascade.
    await this.postRepository.findByIdForUpdate(record.postId);

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

    // Xóa mềm bình luận gốc cùng tất cả phản hồi con (nếu có)
    const deletedRecords = await this.commentRepository.softDeleteWithReplies(command.commentId);
    if (deletedRecords.length === 0) {
      throw new CommentNotFoundException(command.commentId);
    }

    // Giảm bộ đếm comment của bài viết đúng bằng số bản ghi đã soft-delete
    const visibleDeletedCount = deletedRecords.filter((rec) => rec.status === 'visible').length;
    if (visibleDeletedCount > 0) {
      await this.postRepository.incrementCounter(record.postId, 'commentCount', -visibleDeletedCount);
    }

    // Ghi sự kiện outbox content.comment.deleted cho từng bản ghi bị xóa (phục vụ AI worker tóm tắt lại)
    for (const deletedRec of deletedRecords) {
      await this.outbox.add({
        type: 'content.comment.deleted',
        userId: command.userId,
        payload: {
          commentId: deletedRec.id,
          postId: deletedRec.postId,
          authorId: deletedRec.authorId,
          parentCommentId: deletedRec.parentCommentId ?? null,
          deletedBy: command.userId,
          isSuperAdmin: command.isSuperAdmin ?? false,
          deletedAt: (deletedRec.deletedAt ?? new Date()).toISOString(),
        },
      });
    }

    return {
      id: command.commentId,
      deleted: true,
    };
  }
}
