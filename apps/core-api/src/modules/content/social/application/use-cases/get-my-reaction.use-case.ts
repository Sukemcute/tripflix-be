import type { ReactionType } from '../../../db/schema/index.js';
import { ReactionRepository } from '../../infra/reaction.repository.js';

export interface GetMyReactionQuery {
  postId: string;
  userId: string;
}

export interface MyReactionResult {
  postId: string;
  type: ReactionType | null;
}

export class GetMyReactionUseCase {
  constructor(private readonly reactionRepository: ReactionRepository) {}

  async execute(query: GetMyReactionQuery): Promise<MyReactionResult> {
    const reaction = await this.reactionRepository.findByPostAndUser(query.postId, query.userId);
    return {
      postId: query.postId,
      type: (reaction?.type as ReactionType) ?? null,
    };
  }
}
