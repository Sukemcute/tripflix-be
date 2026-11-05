import { PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface GetPostStatsQuery {
  postId: string;
}

export interface PostStatsResult {
  postId: string;
  reactionCounts: Record<string, number>;
  reactionTotal: number;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
}

export class GetPostStatsUseCase {
  constructor(private readonly postRepository: PostRepository) {}

  async execute(query: GetPostStatsQuery): Promise<PostStatsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(query.postId);
    }

    return {
      postId: post.id,
      reactionCounts: post.reactionCounts,
      reactionTotal: post.reactionTotal,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      bookmarkCount: post.bookmarkCount,
    };
  }
}
