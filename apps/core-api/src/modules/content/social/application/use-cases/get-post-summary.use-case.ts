import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import { CommentRepository } from '../../infra/comment.repository.js';
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
    private readonly commentRepository?: CommentRepository,
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

    // Kiểm tra xem thảo luận có thay đổi (comment mới hoặc nội dung comment cũ bị sửa) kể từ thời điểm tóm tắt
    let discussionChanged = false;
    if (this.commentRepository && summary.generatedAt) {
      discussionChanged = await this.commentRepository.hasDiscussionChangedSince(
        query.postId,
        summary.generatedAt,
      );
    }

    // So sánh số lượng bình luận tại thời điểm tóm tắt với số bình luận hiện tại của bài viết
    const countMismatch = (post.commentCount ?? 0) !== (summary.commentCountAtSummary ?? 0);
    const isStale = countMismatch || discussionChanged;

    return {
      ...summary,
      isStale,
    };
  }
}
