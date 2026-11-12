import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  bookmarks,
  posts,
  type BookmarkRecord,
  type PostType,
} from '../../db/schema/index.js';

export interface FindUserBookmarksOptions {
  userId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  postType?: PostType;
}

export class BookmarkRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  /**
   * Lưu hoặc huỷ lưu bài viết (Idempotent).
   */
  async setBookmark(postId: string, userId: string, isBookmarked: boolean): Promise<boolean> {
    if (isBookmarked) {
      await this.db
        .insert(bookmarks)
        .values({ postId, userId })
        .onConflictDoNothing({
          target: [bookmarks.postId, bookmarks.userId],
        });
      return true;
    } else {
      await this.db
        .delete(bookmarks)
        .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)));
      return false;
    }
  }

  async isBookmarked(postId: string, userId: string): Promise<boolean> {
    const [record] = await this.db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
      .limit(1);

    return Boolean(record);
  }

  async findBookmarkedPostIds(postIds: string[], userId: string): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    const rows = await this.db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(and(inArray(bookmarks.postId, postIds), eq(bookmarks.userId, userId)));

    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Lấy danh sách ID các bài viết đã bookmark của người dùng theo cursor.
   */
  async findUserBookmarks(options: FindUserBookmarksOptions): Promise<BookmarkRecord[]> {
    const conditions = [eq(bookmarks.userId, options.userId)];
    if (options.postType) {
      // Lọc ngay trong câu truy vấn; lọc sau khi lấy trang thì trang bị hụt bài.
      conditions.push(
        inArray(
          bookmarks.postId,
          this.db.select({ id: posts.id }).from(posts).where(eq(posts.postType, options.postType)),
        ),
      );
    }

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        or(
          lt(bookmarks.createdAt, options.cursorCreatedAt),
          and(eq(bookmarks.createdAt, options.cursorCreatedAt), lt(bookmarks.id, options.cursorId)),
        )!,
      );
    }

    return this.db
      .select()
      .from(bookmarks)
      .where(and(...conditions))
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
      .limit(options.limit);
  }

  async countByPostId(postId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookmarks)
      .where(eq(bookmarks.postId, postId));

    return result?.count ?? 0;
  }
}
