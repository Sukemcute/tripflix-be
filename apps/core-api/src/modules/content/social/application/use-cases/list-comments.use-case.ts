import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { z } from 'zod';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { CommentReactionRepository } from '../../infra/comment-reaction.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import type { CommentRecord } from '../../../db/schema/index.js';

export interface ListCommentsQuery {
  postId: string;
  limit?: number;
  cursor?: string;
  parentCommentId?: string;
  focusCommentId?: string;
  flat?: boolean;
  viewerId?: string;
  isStaff?: boolean;
}

export type EnrichedCommentItem = CommentRecord & {
  isLiked: boolean;
  likeCount: number;
  replyCount: number;
  authorName: string | null;
};

export interface ListCommentsResult {
  items: EnrichedCommentItem[];
  nextCursor: string | null;
  total: number;
}

function resolveLimit(raw: number | undefined, max: number): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 1) {
    return Math.min(20, max);
  }
  return Math.min(raw, max);
}

export class ListCommentsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
    private readonly commentReactionRepository?: CommentReactionRepository,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(query: ListCommentsQuery): Promise<ListCommentsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post) {
      throw new PostNotFoundException(query.postId);
    }

    // Bảo vệ quyền xem bài viết (draft, private, hidden)
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }

    if (query.focusCommentId !== undefined) {
      const records = await this.findFocusThread(query.postId, query.focusCommentId);
      return { items: await this.enrich(records, query.viewerId), nextCursor: null, total: records.length };
    }

    // Khi bật chế độ flat (cho AI / Indexing / Web / Mobile), cho phép trang tối đa 200 phần tử để giảm I/O
    const maxLimit = query.flat ? 200 : 50;
    const limit = resolveLimit(query.limit, maxLimit);
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

    return { items: await this.enrich(rawItems, query.viewerId), nextCursor, total };
  }

  private async findFocusThread(postId: string, commentId: string): Promise<CommentRecord[]> {
    if (!z.uuid().safeParse(commentId).success) return [];
    const comment = await this.commentRepository.findById(commentId);
    if (!comment || comment.postId !== postId || comment.deletedAt || comment.status !== 'visible') return [];
    if (!comment.parentCommentId) return [comment];
    const parent = await this.commentRepository.findById(comment.parentCommentId);
    if (!parent || parent.postId !== postId || parent.deletedAt || parent.status !== 'visible') return [];
    return [parent, comment];
  }

  private async enrich(rawItems: CommentRecord[], viewerId?: string): Promise<EnrichedCommentItem[]> {
    if (!rawItems.length) return [];
    let likedIds = new Set<string>();
    if (viewerId && this.commentReactionRepository) {
      const commentIds = rawItems.map((c) => c.id);
      likedIds = await this.commentReactionRepository.findLikedCommentIdsByUser(
        viewerId,
        commentIds,
      );
    }

    // App chỉ hiện "Xem N trả lời" khi có trả lời, nên cần số này cho cả trang.
    const replyCounts = await this.commentRepository.countRepliesByParentIds(rawItems.map((c) => c.id));

    // Tên tác giả chỉ để hiển thị: lỗi tra cứu không được làm hỏng danh sách bình luận.
    let authorNames = new Map<string, string>();
    if (this.userDirectory) {
      try {
        authorNames = await this.userDirectory.getDisplayNames(rawItems.map((c) => c.authorId));
      } catch {
        authorNames = new Map();
      }
    }

    return rawItems.map((comment) => ({
      ...comment,
      authorName: authorNames.get(comment.authorId) ?? null,
      likeCount: comment.likeCount ?? 0,
      replyCount: replyCounts.get(comment.id) ?? 0,
      isLiked: likedIds.has(comment.id),
    }));
  }
}
