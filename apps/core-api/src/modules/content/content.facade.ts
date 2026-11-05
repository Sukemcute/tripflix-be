import { Injectable } from '@nestjs/common';
import { decodeSyncCursor, encodeSyncCursor } from './social/application/common/cursor.js';
import { Post, type TripAttachment } from './social/domain/index.js';
import { PostRepository } from './social/infra/post.repository.js';

export interface ListPostsFacadeQuery {
  /** Lấy các bài có updatedAt >= updatedAfter. */
  updatedAfter?: Date | string | null;
  /** Keyset cursor lấy từ nextCursor của trang trước. */
  cursor?: string | null;
  /** Số lượng bài lấy mỗi trang, 1–100, mặc định 50. */
  limit?: number;
}

export interface ListPostsFacadeResult {
  items: VisiblePostSummary[];
  nextCursor: string | null;
}

export interface VisiblePostSummary {
  id: string;
  authorId: string;
  postType: string;
  title: string;
  body: string;
  hashtags: string[];
  status: string;
  visibility: string;
  isVerified: boolean;
  mediaIds: string[];
  coverMediaId: string | null;
  tripAttachment: TripAttachment | null;
  reactionCounts: Record<string, number>;
  reactionTotal: number;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostStatsSummary {
  postId: string;
  reactionTotal: number;
  reactionCounts: Record<string, number>;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
}

/**
 * Facade duy nhất của module Content để các module khác (discovery, analytics, commerce, feed...)
 * có thể gọi trong tiến trình mà không phụ thuộc vào cấu trúc bên trong của Content.
 */
@Injectable()
export class ContentFacade {
  constructor(private readonly postRepo: PostRepository) {}

  /**
   * Lấy thông tin bài viết theo ID cho các module khác (discovery, analytics, feed...).
   * Chỉ trả về bài viết đã xuất bản (published) và chưa bị xoá,
   * đồng thời ẩn thông tin nhạy cảm PII (bookingId trong tripAttachment).
   */
  async getPostById(id: string): Promise<VisiblePostSummary | null> {
    const record = await this.postRepo.findById(id);
    if (!record || record.status !== 'published' || record.deletedAt) {
      return null;
    }

    const domainPost = new Post({
      id: record.id,
      authorId: record.authorId,
      postType: record.postType,
      title: record.title,
      body: record.body,
      hashtags: record.hashtags,
      status: record.status,
      visibility: record.visibility,
      isVerified: record.isVerified,
      mediaIds: record.mediaIds,
      coverMediaId: record.coverMediaId ?? undefined,
      tripAttachment: record.tripAttachment,
      reactionCounts: record.reactionCounts,
      reactionTotal: record.reactionTotal,
      commentCount: record.commentCount,
      shareCount: record.shareCount,
      bookmarkCount: record.bookmarkCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      publishedAt: record.publishedAt ?? undefined,
      deletedAt: record.deletedAt ?? undefined,
    });

    return {
      id: record.id,
      authorId: record.authorId,
      postType: record.postType,
      title: record.title,
      body: record.body,
      hashtags: record.hashtags,
      status: record.status,
      visibility: record.visibility,
      isVerified: record.isVerified,
      mediaIds: record.mediaIds,
      coverMediaId: record.coverMediaId,
      tripAttachment: domainPost.getMaskedTripAttachment(),
      reactionCounts: record.reactionCounts,
      reactionTotal: record.reactionTotal,
      commentCount: record.commentCount,
      shareCount: record.shareCount,
      bookmarkCount: record.bookmarkCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Kiểm tra nhanh bài viết có đang ở trạng thái published hay không.
   */
  async isPostPublished(id: string): Promise<boolean> {
    const post = await this.postRepo.findById(id);
    return post?.status === 'published' && !post.deletedAt;
  }

  /**
   * Lấy danh sách bài viết hiển thị công khai (published + public) cho Discovery và Feed.
   * Dữ liệu lộ trình (tripAttachment) tự động được PII Masking theo quy chuẩn PRD F5.
   */
  async getVisiblePosts(postIds: string[]): Promise<VisiblePostSummary[]> {
    if (postIds.length === 0) return [];

    const records = await this.postRepo.findByIds(postIds);

    const visiblePosts: VisiblePostSummary[] = [];
    for (const record of records) {
      if (record.status !== 'published' || record.visibility !== 'public' || record.deletedAt) {
        continue;
      }

      const domainPost = new Post({
        id: record.id,
        authorId: record.authorId,
        postType: record.postType,
        title: record.title,
        body: record.body,
        hashtags: record.hashtags,
        status: record.status,
        visibility: record.visibility,
        isVerified: record.isVerified,
        mediaIds: record.mediaIds,
        coverMediaId: record.coverMediaId ?? undefined,
        tripAttachment: record.tripAttachment,
        reactionCounts: record.reactionCounts,
        reactionTotal: record.reactionTotal,
        commentCount: record.commentCount,
        shareCount: record.shareCount,
        bookmarkCount: record.bookmarkCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        publishedAt: record.publishedAt ?? undefined,
        deletedAt: record.deletedAt ?? undefined,
      });

      visiblePosts.push({
        id: record.id,
        authorId: record.authorId,
        postType: record.postType,
        title: record.title,
        body: record.body,
        hashtags: record.hashtags,
        status: record.status,
        visibility: record.visibility,
        isVerified: record.isVerified,
        mediaIds: record.mediaIds,
        coverMediaId: record.coverMediaId,
        tripAttachment: domainPost.getMaskedTripAttachment(),
        reactionCounts: record.reactionCounts,
        reactionTotal: record.reactionTotal,
        commentCount: record.commentCount,
        shareCount: record.shareCount,
        bookmarkCount: record.bookmarkCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return visiblePosts;
  }

  /**
   * Lấy số liệu thống kê tương tác thời gian thực của bài viết.
   */
  async getPostStats(postId: string): Promise<PostStatsSummary | null> {
    const post = await this.postRepo.findById(postId);
    if (!post || post.status === 'deleted') return null;

    return {
      postId: post.id,
      reactionTotal: post.reactionTotal,
      reactionCounts: post.reactionCounts,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      bookmarkCount: post.bookmarkCount,
    };
  }

  /**
   * Lấy danh sách bài viết công khai để các module khác (đặc biệt là discovery/search, feed)
   * đồng bộ chỉ mục (Sync / Incremental Indexing).
   *
   * Dữ liệu được sắp xếp theo `updatedAt ASC, id ASC`, hỗ trợ lọc `updatedAfter`
   * và phân trang bằng keyset cursor (`nextCursor`).
   * Dữ liệu trả về tự động được Mask PII (`bookingId` trong `tripAttachment`).
   */
  async listPosts(query: ListPostsFacadeQuery = {}): Promise<ListPostsFacadeResult> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const updatedAfter = query.updatedAfter ? new Date(query.updatedAfter) : undefined;
    const decodedCursor = decodeSyncCursor(query.cursor ?? undefined);

    const records = await this.postRepo.findPostsForSync({
      limit: limit + 1,
      updatedAfter,
      cursorUpdatedAt: decodedCursor?.updatedAt,
      cursorId: decodedCursor?.id,
    });

    const hasMore = records.length > limit;
    const selected = hasMore ? records.slice(0, limit) : records;

    const items: VisiblePostSummary[] = selected.map((record) => {
      const domainPost = new Post({
        id: record.id,
        authorId: record.authorId,
        postType: record.postType,
        title: record.title,
        body: record.body,
        hashtags: record.hashtags,
        status: record.status,
        visibility: record.visibility,
        isVerified: record.isVerified,
        mediaIds: record.mediaIds,
        coverMediaId: record.coverMediaId ?? undefined,
        tripAttachment: record.tripAttachment,
        reactionCounts: record.reactionCounts,
        reactionTotal: record.reactionTotal,
        commentCount: record.commentCount,
        shareCount: record.shareCount,
        bookmarkCount: record.bookmarkCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        publishedAt: record.publishedAt ?? undefined,
        deletedAt: record.deletedAt ?? undefined,
      });

      return {
        id: record.id,
        authorId: record.authorId,
        postType: record.postType,
        title: record.title,
        body: record.body,
        hashtags: record.hashtags,
        status: record.status,
        visibility: record.visibility,
        isVerified: record.isVerified,
        mediaIds: record.mediaIds,
        coverMediaId: record.coverMediaId,
        tripAttachment: domainPost.getMaskedTripAttachment(),
        reactionCounts: record.reactionCounts,
        reactionTotal: record.reactionTotal,
        commentCount: record.commentCount,
        shareCount: record.shareCount,
        bookmarkCount: record.bookmarkCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });

    const lastItem = selected[selected.length - 1];
    const nextCursor = hasMore && lastItem ? encodeSyncCursor(lastItem.updatedAt, lastItem.id) : null;

    return {
      items,
      nextCursor,
    };
  }
}
