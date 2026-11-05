import { Injectable } from '@nestjs/common';
import type { PostRecord } from './db/schema/index.js';
import { Post, type TripAttachment } from './social/domain/index.js';
import { PostRepository } from './social/infra/post.repository.js';

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
   * Lấy bản ghi bài viết theo ID.
   */
  async getPostById(id: string): Promise<PostRecord | null> {
    return this.postRepo.findById(id);
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
}
