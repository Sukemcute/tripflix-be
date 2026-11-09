import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostRecord, PostStatus } from '../../../db/schema/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

export interface ListUserPostsQuery {
  authorId: string;
  limit?: number;
  cursor?: string;
  status?: PostStatus | 'all';
}

export type EnrichedUserPostItem = PostRecord & {
  authorName: string | null;
};

export interface ListUserPostsResult {
  items: EnrichedUserPostItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListUserPostsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(query: ListUserPostsQuery): Promise<ListUserPostsResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const decoded = decodeCursor(query.cursor);

    const records = await this.postRepository.findUserPosts({
      authorId: query.authorId,
      limit: limit + 1,
      cursorCreatedAt: decoded?.createdAt,
      cursorId: decoded?.id,
      status: query.status,
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    let authorName: string | null = null;
    if (items.length > 0 && this.userDirectory) {
      try {
        const names = await this.userDirectory.getDisplayNames([query.authorId]);
        authorName = names.get(query.authorId) ?? null;
      } catch {
        authorName = null;
      }
    }

    const enrichedItems: EnrichedUserPostItem[] = items.map((post) => ({
      ...post,
      authorName,
    }));

    return {
      items: enrichedItems,
      nextCursor,
      hasMore,
    };
  }
}
