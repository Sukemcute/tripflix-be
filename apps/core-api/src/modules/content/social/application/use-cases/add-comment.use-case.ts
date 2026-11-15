import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException, Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
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
    private readonly userDirectory?: UserDirectoryPort,
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

    // Lưu lượt trả lời dưới gốc để giữ phân trang một cấp. Event giữ tác giả của mục được trả lời.
    let threadRootId: string | null = null;
    let replyToAuthorId: string | null = null;
    let parentCommentAuthorId: string | null = null;
    if (command.parentCommentId) {
      const parent = await this.commentRepository.findById(command.parentCommentId);
      if (!parent || parent.postId !== command.postId || parent.deletedAt || parent.status !== 'visible') {
        throw new CommentNotFoundException(command.parentCommentId);
      }
      const root = parent.parentCommentId ? await this.commentRepository.findById(parent.parentCommentId) : parent;
      if (!root || root.postId !== command.postId || root.deletedAt || root.status !== 'visible') {
        throw new CommentNotFoundException(command.parentCommentId);
      }
      Comment.validateParentForReply(root);
      threadRootId = root.id;
      parentCommentAuthorId = root.authorId;
      replyToAuthorId = parent.authorId;
    }

    const displayIds = replyToAuthorId ? [command.authorId, replyToAuthorId] : [command.authorId];
    const names = await this.userDirectory?.getDisplayNames(displayIds).catch(() => undefined);
    const authorDisplayName = names?.get(command.authorId)?.trim();
    const replyToName = replyToAuthorId ? names?.get(replyToAuthorId)?.trim() : undefined;

    const comment = await this.commentRepository.create({
      postId: command.postId,
      authorId: command.authorId,
      parentCommentId: threadRootId,
      ...(replyToName ? { replyToName } : {}),
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
        ...(authorDisplayName ? { authorDisplayName } : {}),
        parentCommentId: threadRootId,
        parentCommentAuthorId,
        ...(command.parentCommentId ? { replyToCommentId: command.parentCommentId, replyToAuthorId } : {}),
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    });

    return comment;
  }
}
