import { Transactional } from '@tripflix/db';
import { CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { CommentReactionRepository } from '../../infra/comment-reaction.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentReactionType } from '../../../db/schema/index.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface SetCommentReactionCommand {
  commentId: string;
  userId: string;
  type?: CommentReactionType | null;
}

export interface SetCommentReactionResult {
  commentId: string;
  isLiked: boolean;
  likeCount: number;
}

export class SetCommentReactionUseCase {
  constructor(
    private readonly commentRepository: CommentRepository,
    private readonly commentReactionRepository: CommentReactionRepository,
    private readonly outbox: ContentOutbox,
    private readonly postRepository?: PostRepository,
  ) {}

  @Transactional('content')
  async execute(command: SetCommentReactionCommand): Promise<SetCommentReactionResult> {
    const comment = await this.commentRepository.findById(command.commentId);
    if (!comment || comment.deletedAt || comment.status !== 'visible') {
      throw new CommentNotFoundException(command.commentId);
    }
    if (this.postRepository) {
      const post = await this.postRepository.findById(comment.postId);
      if (
        !post ||
        post.status !== 'published' ||
        post.deletedAt ||
        (post.visibility !== 'public' && post.authorId !== command.userId)
      )
        throw new CommentNotFoundException(command.commentId);
    }

    const existing = await this.commentReactionRepository.findByCommentAndUser(
      command.commentId,
      command.userId,
    );

    // Xác định trạng thái mong muốn:
    // - type === null: Hủy thích (unlike)
    // - type === 'like': Thích (like)
    // - type undefined / không truyền: Chế độ toggle (chưa thích -> thích, đã thích -> hủy thích)
    let shouldLike: boolean;
    if (command.type === null) {
      shouldLike = false;
    } else if (command.type === 'like') {
      shouldLike = true;
    } else {
      shouldLike = !existing;
    }

    let isLiked = false;
    let likeCount = comment.likeCount ?? 0;

    if (shouldLike) {
      const inserted = await this.commentReactionRepository.insertIfAbsent(
        command.commentId,
        command.userId,
        'like',
      );
      if (inserted) {
        likeCount = await this.commentRepository.incrementLikeCount(command.commentId, 1);
      } else {
        const current = await this.commentRepository.findById(command.commentId);
        likeCount = current?.likeCount ?? comment.likeCount;
      }
      isLiked = true;
    } else {
      const deleted = await this.commentReactionRepository.delete(command.commentId, command.userId);
      if (deleted) {
        likeCount = await this.commentRepository.incrementLikeCount(command.commentId, -1);
      } else {
        const current = await this.commentRepository.findById(command.commentId);
        likeCount = current?.likeCount ?? comment.likeCount;
      }
      isLiked = false;
    }

    // Ghi sự kiện outbox content.comment_reaction.updated trong cùng transaction DB
    await this.outbox.add({
      type: 'content.comment_reaction.updated',
      userId: command.userId,
      payload: {
        commentId: command.commentId,
        postId: comment.postId,
        commentAuthorId: comment.authorId,
        userId: command.userId,
        isLiked,
        likeCount,
      },
    });

    return {
      commentId: command.commentId,
      isLiked,
      likeCount,
    };
  }
}
