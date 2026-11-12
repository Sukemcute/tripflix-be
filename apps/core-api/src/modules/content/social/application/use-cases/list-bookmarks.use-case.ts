import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { Post } from '../../domain/index.js';
import { BookmarkRepository } from '../../infra/bookmark.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostRecord, PostType } from '../../../db/schema/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

export interface ListBookmarksQuery {
  userId: string;
  limit?: number;
  cursor?: string;
  postType?: PostType;
}

export type EnrichedBookmarkPostItem = PostRecord & {
  authorName: string | null;
};

export interface ListBookmarksResult {
  items: EnrichedBookmarkPostItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListBookmarksUseCase {
  constructor(
    private readonly bookmarkRepository: BookmarkRepository,
    private readonly postRepository: PostRepository,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(query: ListBookmarksQuery): Promise<ListBookmarksResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const decoded = decodeCursor(query.cursor);

    const bookmarkRecords = await this.bookmarkRepository.findUserBookmarks({
      userId: query.userId,
      limit: limit + 1,
      cursorCreatedAt: decoded?.createdAt,
      cursorId: decoded?.id,
      postType: query.postType,
    });

    const hasMore = bookmarkRecords.length > limit;
    const pageRecords = hasMore ? bookmarkRecords.slice(0, limit) : bookmarkRecords;

    const postIds = pageRecords.map((b) => b.postId);
    const posts = await this.postRepository.findByIds(postIds);

    // Sắp xếp bài post theo đúng thứ tự bookmark vừa lấy
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const items: PostRecord[] = [];
    for (const id of postIds) {
      const p = postMap.get(id);
      if (p && p.status === 'published' && (p.visibility === 'public' || p.authorId === query.userId)) {
        items.push(p);
      }
    }

    let authorNames = new Map<string, string>();
    if (items.length > 0 && this.userDirectory) {
      try {
        authorNames = await this.userDirectory.getDisplayNames(items.map((p) => p.authorId));
      } catch {
        authorNames = new Map();
      }
    }

    const enrichedItems: EnrichedBookmarkPostItem[] = items.map((post) => {
      const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
      return {
        ...post,
        tripAttachment: domainPost.getMaskedTripAttachment(),
        authorName: authorNames.get(post.authorId) ?? null,
      };
    });

    const lastBookmark = pageRecords[pageRecords.length - 1];
    const nextCursor =
      hasMore && lastBookmark ? encodeCursor(lastBookmark.createdAt, lastBookmark.id) : null;

    return {
      items: enrichedItems,
      nextCursor,
      hasMore,
    };
  }
}
