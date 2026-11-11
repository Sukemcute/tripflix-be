import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { ReactionRepository } from '../../infra/reaction.repository.js';
import type { BookmarkRepository } from '../../infra/bookmark.repository.js';
import type { PostRecord, PostType, ReactionType } from '../../../db/schema/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

export interface ListPostsQuery {
  limit?: number;
  cursor?: string;
  authorId?: string;
  postType?: PostType;
  hashtag?: string;
  keyword?: string;
  viewerId?: string | null;
}

export type EnrichedPostItem = PostRecord & {
  authorName: string | null;
  viewerContext?: {
    myReaction: ReactionType | null;
    isBookmarked: boolean;
  } | null;
};

export interface ListPostsResult {
  items: EnrichedPostItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListPostsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly userDirectory?: UserDirectoryPort,
    private readonly reactionRepository?: ReactionRepository,
    private readonly bookmarkRepository?: BookmarkRepository,
  ) {}

  async execute(query: ListPostsQuery): Promise<ListPostsResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const decoded = decodeCursor(query.cursor);

    // Lấy dư 1 phần tử để xác định hasMore
    const records = await this.postRepository.findPublicPosts({
      limit: limit + 1,
      cursorCreatedAt: decoded?.createdAt,
      cursorId: decoded?.id,
      authorId: query.authorId,
      postType: query.postType,
      hashtag: query.hashtag,
      keyword: query.keyword,
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    let authorNames = new Map<string, string>();
    if (items.length > 0 && this.userDirectory) {
      try {
        authorNames = await this.userDirectory.getDisplayNames(items.map((p) => p.authorId));
      } catch {
        authorNames = new Map();
      }
    }

    const postIds = items.map((p) => p.id);
    let reactionsMap = new Map<string, ReactionType>();
    let bookmarkedSet = new Set<string>();

    if (query.viewerId && postIds.length > 0) {
      const [reactionsResult, bookmarksResult] = await Promise.all([
        this.reactionRepository
          ? this.reactionRepository.findByPostsAndUser(postIds, query.viewerId)
          : Promise.resolve(new Map<string, ReactionType>()),
        this.bookmarkRepository
          ? this.bookmarkRepository.findBookmarkedPostIds(postIds, query.viewerId)
          : Promise.resolve(new Set<string>()),
      ]);
      reactionsMap = reactionsResult;
      bookmarkedSet = bookmarksResult;
    }

    const enrichedItems: EnrichedPostItem[] = items.map((post) => ({
      ...post,
      authorName: authorNames.get(post.authorId) ?? null,
      viewerContext: query.viewerId
        ? {
            myReaction: reactionsMap.get(post.id) ?? null,
            isBookmarked: bookmarkedSet.has(post.id),
          }
        : null,
    }));

    return {
      items: enrichedItems,
      nextCursor,
      hasMore,
    };
  }
}
