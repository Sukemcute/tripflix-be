import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  comments,
  type CommentRecord,
  type NewCommentRecord,
} from '../../db/schema/index.js';

export interface FindCommentsOptions {
  postId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  parentCommentId?: string;
}

export class CommentRepository {
  constructor(private readonly db: Db) {}

  async create(data: NewCommentRecord): Promise<CommentRecord> {
    const [inserted] = await this.db.insert(comments).values(data).returning();
    if (!inserted) throw new Error('Không thể tạo bình luận');
    return inserted;
  }

  async findById(id: string): Promise<CommentRecord | null> {
    const [record] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
      .limit(1);
    return record ?? null;
  }

  async update(id: string, data: Partial<NewCommentRecord>): Promise<CommentRecord> {
    const [updated] = await this.db
      .update(comments)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id))
      .returning();
    if (!updated) throw new Error(`Không thể cập nhật bình luận với ID: ${id}`);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(comments)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id));
  }

  /**
   * Lấy danh sách bình luận theo bài đăng với Keyset Cursor Pagination.
   */
  async findByPostId(options: FindCommentsOptions): Promise<CommentRecord[]> {
    const conditions = [
      eq(comments.postId, options.postId),
      isNull(comments.deletedAt),
    ];

    if (options.parentCommentId) {
      conditions.push(eq(comments.parentCommentId, options.parentCommentId));
    } else {
      conditions.push(isNull(comments.parentCommentId));
    }

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        or(
          lt(comments.createdAt, options.cursorCreatedAt),
          and(eq(comments.createdAt, options.cursorCreatedAt), lt(comments.id, options.cursorId)),
        )!,
      );
    }

    return this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(options.limit);
  }

  async countByPostId(postId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)));
    return result?.count ?? 0;
  }
}
