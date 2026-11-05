import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
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
  flat?: boolean;
}

export interface CountCommentsOptions {
  flat?: boolean;
  parentCommentId?: string;
}

export class CommentRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

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
   * Xóa mềm bình luận gốc cùng tất cả các phản hồi con (nếu có) trong cùng một thao tác.
   * Chỉ cập nhật những bản ghi có deletedAt IS NULL.
   * Trả về danh sách tất cả bản ghi vừa bị soft-delete để use case cập nhật counter và phát outbox events.
   */
  async softDeleteWithReplies(id: string): Promise<CommentRecord[]> {
    const now = new Date();
    const deletedRecords = await this.db
      .update(comments)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          or(eq(comments.id, id), eq(comments.parentCommentId, id)),
          isNull(comments.deletedAt),
        ),
      )
      .returning();

    return deletedRecords;
  }

  /**
   * Cập nhật số lượt thích của bình luận (Atomic counter với SQL GREATEST).
   * Không cập nhật updatedAt để tránh làm sai lệch cờ isStale của bản tóm tắt AI.
   */
  async incrementLikeCount(id: string, delta: number): Promise<number> {
    const [updated] = await this.db
      .update(comments)
      .set({
        likeCount: sql<number>`GREATEST(${comments.likeCount} + ${delta}, 0)`,
      })
      .where(eq(comments.id, id))
      .returning({ likeCount: comments.likeCount });
    return updated?.likeCount ?? 0;
  }

  /**
   * Kiểm tra xem thảo luận có thay đổi (có bình luận mới hoặc bình luận được sửa nội dung)
   * kể từ thời điểm `since` (thời điểm sinh tóm tắt AI).
   * Lượt thả tim không làm kích hoạt cờ này vì không làm thay đổi updatedAt của comment.
   */
  async hasDiscussionChangedSince(postId: string, since: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          isNull(comments.deletedAt),
          or(
            gt(comments.createdAt, since),
            and(eq(comments.isEdited, true), gt(comments.updatedAt, since)),
          ),
        ),
      )
      .limit(1);

    return Boolean(row);
  }

  /**
   * Lấy danh sách bình luận theo bài đăng với Keyset Cursor Pagination.
   * Nếu options.flat = true: trả về mọi cấp bình luận (cả gốc và phản hồi),
   * mỗi phần tử có sẵn parentCommentId phục vụ AI tóm tắt hoặc xây dựng cây bình luận.
   */
  async findByPostId(options: FindCommentsOptions): Promise<CommentRecord[]> {
    const conditions = [
      eq(comments.postId, options.postId),
      isNull(comments.deletedAt),
    ];

    if (!options.flat) {
      if (options.parentCommentId) {
        conditions.push(eq(comments.parentCommentId, options.parentCommentId));
      } else {
        conditions.push(isNull(comments.parentCommentId));
      }
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

  /**
   * Đếm số lượng bình luận phù hợp theo điều kiện phân trang.
   * - flat = true: đếm toàn bộ bình luận của bài (gốc + phản hồi).
   * - parentCommentId: đếm số phản hồi con của bình luận cha.
   * - Mặc định: đếm số bình luận gốc (parentCommentId IS NULL).
   */
  async countByPostId(postId: string, options?: CountCommentsOptions): Promise<number> {
    const conditions = [
      eq(comments.postId, postId),
      isNull(comments.deletedAt),
    ];

    if (!options?.flat) {
      if (options?.parentCommentId) {
        conditions.push(eq(comments.parentCommentId, options.parentCommentId));
      } else {
        conditions.push(isNull(comments.parentCommentId));
      }
    }

    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(...conditions));
    return result?.count ?? 0;
  }
}
