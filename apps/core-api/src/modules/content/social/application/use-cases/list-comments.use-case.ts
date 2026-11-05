import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { CommentReactionRepository } from '../../infra/comment-reaction.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { CommentRecord } from '../../../db/schema/index.js';

export interface ListCommentsQuery {
  postId: string;
  limit?: number;
  cursor?: string;
  parentCommentId?: string;
  flat?: boolean;
  viewerId?: string;
}

export type EnrichedCommentItem = CommentRecord & {
  isLiked: boolean;
  likeCount: number;
};

export interface ListCommentsResult {
  items: EnrichedCommentItem[];
  nextCursor: string | null;
  total: number;
}

export class ListCommentsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
    private readonly commentReactionRepository?: CommentReactionRepository,
  ) {}

  async execute(query: ListCommentsQuery): Promise<ListCommentsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(query.postId);
    }

    // Khi bật chế độ flat (cho AI / Indexing), cho phép trang tối đa 200 phần tử để giảm I/O
    const maxLimit = query.flat ? 200 : 50;
    const limit = Math.min(Math.max(query.limit ?? 20, 1), maxLimit);
    const decoded = decodeCursor(query.cursor);

    const [records, total] = await Promise.all([
      this.commentRepository.findByPostId({
        postId: query.postId,
        limit: limit + 1,
        cursorCreatedAt: decoded?.createdAt,
        cursorId: decoded?.id,
        parentCommentId: query.parentCommentId,
        flat: query.flat,
      }),
      this.commentRepository.countByPostId(query.postId, {
        flat: query.flat,
        parentCommentId: query.parentCommentId,
      }),
    ]);

    const hasMore = records.length > limit;
    const rawItems = hasMore ? records.slice(0, limit) : records;

    const lastItem = rawItems[rawItems.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    let likedIds = new Set<string>();
    if (query.viewerId && rawItems.length > 0 && this.commentReactionRepository) {
      const commentIds = rawItems.map((c) => c.id);
      likedIds = await this.commentReactionRepository.findLikedCommentIdsByUser(
        query.viewerId,
        commentIds,
      );
    }

    const items: EnrichedCommentItem[] = rawItems.map((comment) => ({
      ...comment,
      likeCount: comment.likeCount ?? 0,
      isLiked: likedIds.has(comment.id),
    }));

    return {
      items,
      nextCursor,
      total,
    };
  }
}
