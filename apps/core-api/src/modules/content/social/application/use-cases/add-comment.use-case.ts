import { Transactional } from '@tripflix/db';
import { Comment, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord } from '../../../db/schema/index.js';

export interface AddCommentCommand {
  postId: string;
  authorId: string;
  body: string;
  parentCommentId?: string;
}

export class AddCommentUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
    private readonly outbox: ContentOutbox,
  ) {}

  @Transactional('content')
  async execute(command: AddCommentCommand): Promise<CommentRecord> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted' || post.status === 'hidden') {
      throw new PostNotFoundException(command.postId);
    }

    const body = command.body.trim();
    if (!body) {
      throw new Error('Nội dung bình luận không được để trống');
    }

    // Nếu là reply, kiểm tra parent comment tồn tại và không phải reply của reply (chỉ 1 cấp)
    if (command.parentCommentId) {
      const parent = await this.commentRepository.findById(command.parentCommentId);
      if (!parent || parent.postId !== command.postId) {
        throw new Error('Bình luận gốc không hợp lệ hoặc đã bị xóa');
      }
      Comment.validateParentForReply(parent);
    }

    const comment = await this.commentRepository.create({
      postId: command.postId,
      authorId: command.authorId,
      parentCommentId: command.parentCommentId ?? null,
      body,
      isEdited: false,
    });

    // Tăng bộ đếm bình luận của bài viết
    await this.postRepository.incrementCounter(command.postId, 'commentCount', 1);

    // Ghi sự kiện outbox content.comment.created trong cùng transaction DB (phục vụ notification)
    await this.outbox.add({
      type: 'content.comment.created',
      userId: command.authorId,
      payload: {
        commentId: comment.id,
        postId: command.postId,
        postAuthorId: post.authorId,
        authorId: command.authorId,
        parentCommentId: command.parentCommentId ?? null,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    });

    return comment;
  }
}
