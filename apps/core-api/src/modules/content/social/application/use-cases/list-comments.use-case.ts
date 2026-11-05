import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { CommentRecord } from '../../../db/schema/index.js';

export interface ListCommentsQuery {
  postId: string;
  limit?: number;
  cursor?: string;
  parentCommentId?: string;
}

export interface ListCommentsResult {
  items: CommentRecord[];
  nextCursor: string | null;
  total: number;
}

export class ListCommentsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
  ) {}

  async execute(query: ListCommentsQuery): Promise<ListCommentsResult> {
    const post = await this.postRepository.findById(query.postId);
    if (!post || post.status === 'deleted') {
      throw new PostNotFoundException(query.postId);
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const decoded = decodeCursor(query.cursor);

    const [records, total] = await Promise.all([
      this.commentRepository.findByPostId({
        postId: query.postId,
        limit: limit + 1,
        cursorCreatedAt: decoded?.createdAt,
        cursorId: decoded?.id,
        parentCommentId: query.parentCommentId,
      }),
      this.commentRepository.countByPostId(query.postId),
    ]);

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    return {
      items,
      nextCursor,
      total,
    };
  }
}
