import { Transactional } from '@tripflix/db';
import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { ReactionRepository } from '../../infra/reaction.repository.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { ReactionType } from '../../../db/schema/index.js';

export interface SetReactionCommand {
  postId: string;
  userId: string;
  type: ReactionType | null;
}

export interface SetReactionResult {
  postId: string;
  myReaction: ReactionType | null;
  reactionCounts: Record<string, number>;
  reactionTotal: number;
}

export class SetReactionUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly reactionRepository: ReactionRepository,
    private readonly outbox: ContentOutbox,
  ) {}

  @Transactional('content')
  async execute(command: SetReactionCommand): Promise<SetReactionResult> {
    const post = await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    if (command.type !== null) {
      await this.reactionRepository.upsert(command.postId, command.userId, command.type);
    } else {
      await this.reactionRepository.delete(command.postId, command.userId);
    }

    // Tổng hợp lại chính xác số lượng cảm xúc
    const { reactionCounts, reactionTotal } = await this.reactionRepository.aggregateReactionCounts(
      command.postId,
    );

    // Cập nhật ngược lại bảng posts
    await this.postRepository.updateReactionCounts(command.postId, reactionCounts, reactionTotal);

    // Ghi sự kiện outbox content.reaction.updated trong cùng transaction DB
    await this.outbox.add({
      type: 'content.reaction.updated',
      userId: command.userId,
      payload: {
        postId: command.postId,
        userId: command.userId,
        type: command.type,
        reactionTotal,
        reactionCounts,
      },
    });

    return {
      postId: command.postId,
      myReaction: command.type,
      reactionCounts,
      reactionTotal,
    };
  }
}
