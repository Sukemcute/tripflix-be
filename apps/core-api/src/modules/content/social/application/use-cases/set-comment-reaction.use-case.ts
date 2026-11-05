import { Transactional } from '@tripflix/db';
import { CommentNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { CommentReactionRepository } from '../../infra/comment-reaction.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentReactionType } from '../../../db/schema/index.js';

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
  ) {}

  @Transactional('content')
  async execute(command: SetCommentReactionCommand): Promise<SetCommentReactionResult> {
    const comment = await this.commentRepository.findById(command.commentId);
    if (!comment || comment.deletedAt) {
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
      if (!existing) {
        await this.commentReactionRepository.upsert(command.commentId, command.userId, 'like');
        likeCount = await this.commentRepository.incrementLikeCount(command.commentId, 1);
      }
      isLiked = true;
    } else {
      if (existing) {
        await this.commentReactionRepository.delete(command.commentId, command.userId);
        likeCount = await this.commentRepository.incrementLikeCount(command.commentId, -1);
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
