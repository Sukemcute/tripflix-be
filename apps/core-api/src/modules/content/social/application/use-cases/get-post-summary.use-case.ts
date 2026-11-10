import { Post, PostNotFoundException } from '../../domain/index.js';
import { PostRepository } from '../../infra/post.repository.js';
import { PostSummaryRepository } from '../../infra/post-summary.repository.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import type { PostSummaryRecord } from '../../../db/schema/index.js';
import { collectCitationIds, filterCitations } from '../../domain/summary-sources.js';

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

    const sourceCommentIds = summary.sourceCommentIds ?? null;
    let blocked = false;
    if (this.commentRepository) {
      blocked =
        sourceCommentIds === null
          ? await this.commentRepository.hasUnavailableSince(query.postId, summary.generatedAt ?? new Date(0))
          : (await this.commentRepository.findVisibleIds(query.postId, sourceCommentIds)).length !==
            new Set(sourceCommentIds).size;
    }
    const citedIds = [
      ...new Set([...collectCitationIds(summary.content), ...collectCitationIds(summary.safety)]),
    ];
    const visibleCitations = new Set(
      this.commentRepository && citedIds.length
        ? await this.commentRepository.findVisibleIds(query.postId, citedIds)
        : [],
    );
    const safeContent = citedIds.length
      ? filterCitations(summary.content, visibleCitations)
      : summary.content;
    const safeSafety = citedIds.length ? filterCitations(summary.safety, visibleCitations) : summary.safety;

    return {
      ...summary,
      sourceCommentIds,
      summary: blocked ? null : summary.summary,
      keyTakeaways: blocked ? [] : summary.keyTakeaways,
      content: blocked ? null : safeContent,
      safety: blocked ? null : query.isStaff ? safeSafety : withoutPendingWarnings(safeSafety),
      isStale: blocked || isStale,
    };
  }
}

/**
 * Cảnh báo an toàn dạng "nghe nói" (safety.pendingWarnings) chờ kiểm duyệt nên chỉ moderator
 * và superadmin thấy; người xem khác chỉ nhận safety.warnings đã công khai.
 */
function withoutPendingWarnings(safety: PostSummaryRecord['safety']): PostSummaryRecord['safety'] {
  if (typeof safety !== 'object' || safety === null || Array.isArray(safety)) return safety;
  if (!('pendingWarnings' in safety)) return safety;
  const { pendingWarnings: _pending, ...rest } = safety as Record<string, unknown>;
  return rest;
}
