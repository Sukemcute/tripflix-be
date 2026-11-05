import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostRecord, PostType } from '../../../db/schema/index.js';

export interface ListPostsQuery {
  limit?: number;
  cursor?: string;
  authorId?: string;
  postType?: PostType;
  hashtag?: string;
  keyword?: string;
}

export interface ListPostsResult {
  items: PostRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListPostsUseCase {
  constructor(private readonly postRepository: PostRepository) {}

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

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}
