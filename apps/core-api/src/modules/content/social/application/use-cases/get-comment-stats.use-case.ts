import { Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';

export interface GetCommentStatsQuery {
  postId: string;
  viewerId?: string;
  isStaff?: boolean;
}

export interface GetCommentStatsResult {
  postId: string;
  visibleCommentCount: number;
  uniqueAuthorCount: number;
}

export class GetCommentStatsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async execute(query: GetCommentStatsQuery): Promise<GetCommentStatsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post) {
      throw new PostNotFoundException(query.postId);
    }

    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }

    const stats = await this.commentRepository.getCommentStats(query.postId);

    return {
      postId: query.postId,
      visibleCommentCount: stats.visibleCommentCount,
      uniqueAuthorCount: stats.uniqueAuthorCount,
    };
  }
}
