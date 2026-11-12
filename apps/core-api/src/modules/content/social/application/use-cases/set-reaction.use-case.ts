import { Transactional } from '@tripflix/db';
import { InvalidReactionTypeException, Post, PostNotFoundException } from '../../domain/index.js';
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
    // Khóa bi quan hàng post để tuần tự hóa các lượt reaction đồng thời, loại bỏ triệt để lost update
    const post = this.postRepository.findByIdForUpdate
      ? await this.postRepository.findByIdForUpdate(command.postId)
      : await this.postRepository.findById(command.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(command.postId);
    }

    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(command.userId)) {
      throw new PostNotFoundException(command.postId);
    }

    // Repository ghi thẳng type xuống DB nên phải chặn loại lạ ở đây.
    if (command.type !== null && !['like', 'love', 'helpful'].includes(command.type)) {
      throw new InvalidReactionTypeException(command.type);
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
