import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostStatus } from '../../../db/schema/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

/** Tên dự phòng khi không tra được tên hiển thị (user đã xoá, access lỗi). */
export function buildFallbackDisplayName(userId: string): string {
  return `User ${userId.slice(0, 8)}`;
}

export interface ListAdminPostsQuery {
  limit?: number;
  cursor?: string;
  status?: PostStatus;
  authorId?: string;
}

export interface AdminPostListItem {
  id: string;
  author: { id: string; display_name: string };
  title: string;
  post_type: string;
  status: string;
  visibility: string;
  report_count: number;
  reaction_total: number;
  comment_count: number;
  created_at: string;
}

export interface ListAdminPostsResult {
  items: AdminPostListItem[];
  next_cursor: string | null;
  total: number;
}

export class ListAdminPostsUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly userDirectory?: UserDirectoryPort,
  ) {}

  async execute(query: ListAdminPostsQuery): Promise<ListAdminPostsResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursorObj = decodeCursor(query.cursor);

    const posts = await this.postRepository.findAdminPosts({
      limit: limit + 1,
      cursorCreatedAt: cursorObj?.createdAt,
      cursorId: cursorObj?.id,
      status: query.status,
      authorId: query.authorId,
    });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    const total = await this.postRepository.countAdminPosts({
      status: query.status,
      authorId: query.authorId,
    });

    let authorNames = new Map<string, string>();
    if (items.length > 0 && this.userDirectory) {
      try {
        authorNames = await this.userDirectory.getDisplayNames([
          ...new Set(items.map((p) => p.authorId)),
        ]);
      } catch {
        // Không tra được tên thì vẫn trả danh sách, dùng tên dự phòng.
        authorNames = new Map();
      }
    }

    return {
      items: items.map((p) => ({
        id: p.id,
        author: {
          id: p.authorId,
          display_name: authorNames.get(p.authorId) ?? buildFallbackDisplayName(p.authorId),
        },
        title: p.title,
        post_type: p.postType,
        status: p.status,
        visibility: p.visibility,
        report_count: 0,
        reaction_total: p.reactionTotal,
        comment_count: p.commentCount,
        created_at: p.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
      total,
    };
  }
}
