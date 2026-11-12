import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException, Post, PostNotFoundException } from '../../domain/index.js';
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
    const post = await this.postRepository.findByIdForUpdate(command.postId);
    if (!post) {
      throw new PostNotFoundException(command.postId);
    }

    // Người dùng chỉ có thể bình luận vào bài viết mà mình có quyền xem (chặn draft, private, removed, hidden)
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(command.authorId)) {
      throw new PostNotFoundException(command.postId);
    }

    const body = Comment.validateBody(command.body);

    // Nếu là reply, kiểm tra parent comment tồn tại và không phải reply của reply (chỉ 1 cấp)
    let parentCommentAuthorId: string | null = null;
    if (command.parentCommentId) {
      const parent = await this.commentRepository.findById(command.parentCommentId);
      if (!parent || parent.postId !== command.postId || parent.deletedAt || parent.status !== 'visible') {
        throw new CommentNotFoundException(command.parentCommentId);
      }
      Comment.validateParentForReply(parent);
      parentCommentAuthorId = parent.authorId;
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
        parentCommentAuthorId,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    });

    return comment;
  }
}
