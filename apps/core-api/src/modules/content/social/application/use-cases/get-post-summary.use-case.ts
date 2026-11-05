import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';

export interface GetPostSummaryQuery {
  postId: string;
  viewerId?: string;
  isStaff?: boolean;
}

export type PostSummaryWithStale = PostSummaryRecord & {
  isStale: boolean;
};

export class GetPostSummaryUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly postSummaryRepository: PostSummaryRepository,
  ) {}

  async execute(input: string | GetPostSummaryQuery): Promise<PostSummaryWithStale | null> {
    const query: GetPostSummaryQuery = typeof input === 'string' ? { postId: input } : input;
    const post = await this.postRepository.findById(query.postId);
    if (!post) {
      throw new PostNotFoundException(query.postId);
    }

    // Bảo vệ quyền xem bài viết (draft, private, hidden)
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }

    const summary = await this.postSummaryRepository.findByPostId(query.postId);
    if (!summary) return null;

    // So sánh số lượng bình luận tại thời điểm tóm tắt với số bình luận hiện tại của bài viết
    const isStale = (post.commentCount ?? 0) !== (summary.commentCountAtSummary ?? 0);

    return {
      ...summary,
      isStale,
    };
  }
}
