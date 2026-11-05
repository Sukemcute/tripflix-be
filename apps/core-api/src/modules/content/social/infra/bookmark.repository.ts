import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  bookmarks,
  type BookmarkRecord,
} from '../../db/schema/index.js';

export interface FindUserBookmarksOptions {
  userId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
}

export class BookmarkRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  /**
   * Thêm bookmark nếu chưa có (Idempotent). Trả về true nếu thực sự thêm mới, false nếu đã tồn tại.
   */
  async insertIfAbsent(postId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .insert(bookmarks)
      .values({ postId, userId })
      .onConflictDoNothing({
        target: [bookmarks.postId, bookmarks.userId],
      })
      .returning({ id: bookmarks.id });
    return rows.length > 0;
  }

  /**
   * Xóa bookmark nếu tồn tại (Idempotent). Trả về true nếu thực sự xóa, false nếu không tồn tại.
   */
  async deleteIfExists(postId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
      .returning({ id: bookmarks.id });
    return rows.length > 0;
  }

  /**
   * Lưu hoặc huỷ lưu bài viết (Idempotent).
   */
  async setBookmark(postId: string, userId: string, isBookmarked: boolean): Promise<boolean> {
    return isBookmarked ? this.insertIfAbsent(postId, userId) : this.deleteIfExists(postId, userId);
  }

  async isBookmarked(postId: string, userId: string): Promise<boolean> {
    const [record] = await this.db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
      .limit(1);

    return Boolean(record);
  }

  /**
   * Lấy danh sách ID các bài viết đã bookmark của người dùng theo cursor.
   */
  async findUserBookmarks(options: FindUserBookmarksOptions): Promise<BookmarkRecord[]> {
    const conditions = [eq(bookmarks.userId, options.userId)];

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
