import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { BookmarkRepository } from '../../infra/bookmark.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import { Post } from '../../domain/index.js';
import type { PostRecord, TripAttachmentData } from '../../../db/schema/index.js';

export interface ListBookmarksQuery {
  userId: string;
  limit?: number;
  cursor?: string;
}

export interface ListBookmarksResult {
  items: Array<Omit<PostRecord, 'tripAttachment'> & { tripAttachment: TripAttachmentData | null }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListBookmarksUseCase {
  constructor(
    private readonly bookmarkRepository: BookmarkRepository,
    private readonly postRepository: PostRepository,
  ) {}

  async execute(query: ListBookmarksQuery): Promise<ListBookmarksResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const decoded = decodeCursor(query.cursor);

    const bookmarkRecords = await this.bookmarkRepository.findUserBookmarks({
      userId: query.userId,
      limit: limit + 1,
      cursorCreatedAt: decoded?.createdAt,
      cursorId: decoded?.id,
    });

    const hasMore = bookmarkRecords.length > limit;
    const pageRecords = hasMore ? bookmarkRecords.slice(0, limit) : bookmarkRecords;

    const postIds = pageRecords.map((b) => b.postId);
    const posts = await this.postRepository.findByIds(postIds);

    // Sắp xếp bài post theo đúng thứ tự bookmark vừa lấy, kiểm tra quyền xem và che PII
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const items: Array<Omit<PostRecord, 'tripAttachment'> & { tripAttachment: TripAttachmentData | null }> = [];
    for (const id of postIds) {
      const p = postMap.get(id);
      if (p) {
        const domainPost = new Post({
          ...p,
          coverMediaId: p.coverMediaId ?? undefined,
        });
        if (domainPost.canBeViewedBy(query.userId)) {
          items.push({
            ...p,
            tripAttachment: domainPost.getMaskedTripAttachment(),
          });
        }
      }
    }

    const lastBookmark = pageRecords[pageRecords.length - 1];
    const nextCursor =
      hasMore && lastBookmark ? encodeCursor(lastBookmark.createdAt, lastBookmark.id) : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}
