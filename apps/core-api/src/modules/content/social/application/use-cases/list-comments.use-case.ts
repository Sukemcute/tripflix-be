import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { formatReplyExcerpt, isPublicReplyTarget } from '../common/reply-excerpt.js';
import { z } from 'zod';
import { Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { CommentReactionRepository } from '../../infra/comment-reaction.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import type { CommentRecord, PostRecord } from '../../../db/schema/index.js';

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

export type EnrichedCommentItem = Omit<CommentRecord, 'hiddenByActionId' | 'cascadeRootCommentId'> & {
  moderationState: 'hidden' | null;
  isLiked: boolean;
  likeCount: number;
  replyCount: number;
  authorName: string | null;
  replyToCommentId: string | null;
  replyToExcerpt: string | null;
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
    if (query.focusCommentId !== undefined) {
      this.assertViewable(await this.postRepository.findById(query.postId), query);
      const records = await this.findFocusThread(query.postId, query.focusCommentId, query.viewerId, query.isStaff);
      return { items: await this.enrich(records, query.viewerId), nextCursor: null, total: records.length };
    }

    // Khi bật chế độ flat (cho AI / Indexing / Web / Mobile), cho phép trang tối đa 200 phần tử để giảm I/O
    const maxLimit = query.flat ? 200 : 50;
    const limit = resolveLimit(query.limit, maxLimit);
    const decoded = decodeCursor(query.cursor);
    const viewerScope = {
      ...(query.viewerId ? { viewerId: query.viewerId } : {}),
      ...(query.isStaff ? { isStaff: true } : {}),
    };

    // Đọc bài, lấy trang và đếm chạy song song; trang sau dùng lại tổng đếm ở trang đầu (mang trong cursor).
    // Bài không xem được thì báo 404 trước khi trả bất cứ dữ liệu nào.
    const [post, records, total] = await Promise.all([
      this.postRepository.findById(query.postId),
      this.commentRepository.findPage({
        postId: query.postId,
        limit: limit + 1,
        cursorCreatedAt: decoded?.createdAt,
        cursorId: decoded?.id,
        parentCommentId: query.parentCommentId,
        flat: query.flat,
        ...viewerScope,
      }),
      decoded?.total ??
        this.commentRepository.countByPostId(query.postId, {
          flat: query.flat,
          ...viewerScope,
          parentCommentId: query.parentCommentId,
        }),
    ]);
    this.assertViewable(post, query);

    const hasMore = records.length > limit;
    const pageItems = hasMore ? records.slice(0, limit) : records;

    const lastItem = pageItems[pageItems.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id, total) : null;

    const [authorNames, replyTargets] = await Promise.all([
      this.findAuthorNames(pageItems),
      this.findReplyTargets(query.postId, pageItems),
    ]);
    const items = pageItems.map((comment) => this.toEnrichedItem(comment, authorNames, replyTargets, {
      replyCount: comment.replyCount,
      isLiked: comment.isLiked,
    }));
    return { items, nextCursor, total };
  }

  /** Bảo vệ quyền xem bài viết (draft, private, hidden, held). */
  private assertViewable(post: PostRecord | null, query: ListCommentsQuery): void {
    if (!post) throw new PostNotFoundException(query.postId);
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (!domainPost.canBeViewedBy(query.viewerId, query.isStaff)) {
      throw new PostNotFoundException(query.postId);
    }
  }

  /** Tên tác giả chỉ để hiển thị: lỗi tra cứu không được làm hỏng danh sách bình luận. */
  private async findAuthorNames(records: CommentRecord[]): Promise<Map<string, string>> {
    if (!records.length || !this.userDirectory) return new Map();
    try {
      return await this.userDirectory.getDisplayNames(records.map((c) => c.authorId));
    } catch {
      return new Map();
    }
  }

  /** Đọc lô câu được trả lời trên cùng trang (1 truy vấn WHERE id IN (...), tránh N+1). */
  private async findReplyTargets(
    postId: string,
    records: readonly CommentRecord[],
  ): Promise<Map<string, CommentRecord>> {
    const targetIds = [
      ...new Set(records.map((comment) => comment.replyToCommentId).filter((id): id is string => Boolean(id))),
    ];
    if (!targetIds.length || typeof this.commentRepository.findByIds !== 'function') {
      return new Map();
    }
    const targets = await this.commentRepository.findByIds(postId, targetIds);
    return new Map(targets.map((target) => [target.id, target]));
  }

  private async findFocusThread(postId: string, commentId: string, viewerId?: string, isStaff = false): Promise<CommentRecord[]> {
    if (!z.uuid().safeParse(commentId).success) return [];
    const comment = await this.commentRepository.findById(commentId);
    if (!comment || comment.postId !== postId || comment.deletedAt || !this.canRead(comment, viewerId, isStaff)) return [];
    if (!comment.parentCommentId) return [comment];
    const parent = await this.commentRepository.findById(comment.parentCommentId);
    if (!parent || parent.postId !== postId || parent.deletedAt || !this.canRead(parent, viewerId, isStaff)) return [];
    return [parent, comment];
  }

  private canRead(comment: CommentRecord, viewerId?: string, isStaff = false): boolean {
    return comment.status === 'visible' ||
      (comment.status === 'held' && (isStaff || viewerId === comment.authorId)) ||
      (['hidden', 'removed'].includes(comment.status) && viewerId === comment.authorId);
  }

  private toEnrichedItem(
    comment: CommentRecord,
    authorNames: Map<string, string>,
    replyTargets: Map<string, CommentRecord>,
    extras: { isLiked?: boolean; replyCount?: number } = {},
  ): EnrichedCommentItem {
    const moderated = comment.status === 'hidden' || comment.status === 'removed';
    const { hiddenByActionId: _hiddenByActionId, cascadeRootCommentId: _cascadeRootCommentId, ...publicComment } = comment;
    const replyToCommentId = comment.replyToCommentId ?? null;
    const replyTarget = replyToCommentId ? replyTargets.get(replyToCommentId) : undefined;
    const replyToExcerpt =
      !moderated && replyToCommentId && isPublicReplyTarget(replyTarget, comment.postId)
        ? formatReplyExcerpt(replyTarget.body)
        : null;

    return {
      ...publicComment,
      status: moderated ? 'hidden' : comment.status,
      body: moderated ? '' : comment.body,
      mentions: moderated ? [] : (comment.mentions ?? []),
      moderationState: moderated ? 'hidden' : null,
      authorName: authorNames.get(comment.authorId) ?? null,
      replyToCommentId,
      replyToName: comment.replyToName ?? null,
      replyToExcerpt,
      likeCount: comment.likeCount ?? 0,
      replyCount: extras.replyCount ?? 0,
      isLiked: extras.isLiked ?? false,
    };
  }

  /** Luồng mở bình luận được nhắc tới (1–2 dòng): lấy lượt thích và số trả lời riêng. */
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

    const postId = rawItems[0]!.postId;
    // App chỉ hiện "Xem N trả lời" khi có trả lời, nên cần số này cho cả trang.
    const [replyCounts, authorNames, replyTargets] = await Promise.all([
      this.commentRepository.countRepliesByParentIds(rawItems.map((c) => c.id)),
      this.findAuthorNames(rawItems),
      this.findReplyTargets(postId, rawItems),
    ]);

    return rawItems.map((comment) => this.toEnrichedItem(comment, authorNames, replyTargets, {
      replyCount: replyCounts.get(comment.id) ?? 0,
      isLiked: likedIds.has(comment.id),
    }));
  }
}
