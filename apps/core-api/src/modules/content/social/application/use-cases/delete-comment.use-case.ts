import { Comment, CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';

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
  ) {}

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

    return {
      id: command.commentId,
      deleted: true,
    };
  }
}
