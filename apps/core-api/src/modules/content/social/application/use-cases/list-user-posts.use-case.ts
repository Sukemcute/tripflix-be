import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostRecord, PostStatus } from '../../../db/schema/index.js';

export interface ListUserPostsQuery {
  authorId: string;
  limit?: number;
  cursor?: string;
  status?: PostStatus | 'all';
}

export interface ListUserPostsResult {
  items: PostRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListUserPostsUseCase {
  constructor(private readonly postRepository: PostRepository) {}

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

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}
