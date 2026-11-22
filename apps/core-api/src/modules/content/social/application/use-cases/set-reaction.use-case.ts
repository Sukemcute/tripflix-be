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

    // Dòng bài đang khoá nên số đếm trên bài không đổi dưới tay mình: cộng trừ đúng phần thay đổi
    // thay vì đếm lại mọi cảm xúc của bài (bài nhiều tim thì count(*) quét rất nhiều dòng trong lúc giữ khoá).
    const previous = await this.reactionRepository.findByPostAndUser(command.postId, command.userId);
    if (command.type !== null) {
      await this.reactionRepository.upsert(command.postId, command.userId, command.type);
    } else {
      await this.reactionRepository.delete(command.postId, command.userId);
    }
    const { reactionCounts, reactionTotal } = applyReactionChange(
      post.reactionCounts,
      previous?.type ?? null,
      command.type,
    );
    await this.postRepository.updateReactionCounts(command.postId, reactionCounts, reactionTotal);

    // Ghi sự kiện outbox content.reaction.updated trong cùng transaction DB
    await this.outbox.add({
      type: 'content.reaction.updated',
      userId: command.userId,
      payload: {
        postId: command.postId,
        postAuthorId: post.authorId,
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

/** Số cảm xúc sau khi một người đổi từ `previousType` sang `nextType` (null là không thả). Bỏ loại về 0. */
export function applyReactionChange(
  reactionCounts: Record<string, number>,
  previousType: ReactionType | null,
  nextType: ReactionType | null,
): { reactionCounts: Record<string, number>; reactionTotal: number } {
  const nextCounts = { ...reactionCounts };
  if (previousType !== nextType) {
    if (previousType) {
      const remaining = (nextCounts[previousType] ?? 0) - 1;
      if (remaining > 0) nextCounts[previousType] = remaining;
      else delete nextCounts[previousType];
    }
    if (nextType) nextCounts[nextType] = (nextCounts[nextType] ?? 0) + 1;
  }
  const reactionTotal = Object.values(nextCounts).reduce((sum, count) => sum + count, 0);
  return { reactionCounts: nextCounts, reactionTotal };
}
