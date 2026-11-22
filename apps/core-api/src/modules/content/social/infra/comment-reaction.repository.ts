import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  commentReactions,
  type CommentReactionRecord,
  type CommentReactionType,
} from '../../db/schema/index.js';

export class CommentReactionRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  /**
   * Thêm cảm xúc nếu chưa có (Atomic Idempotent Insert).
   * Trả về true nếu thêm mới thành công, false nếu đã tồn tại trước đó.
   */
  async insertIfAbsent(
    commentId: string,
    userId: string,
    type: CommentReactionType = 'like',
  ): Promise<boolean> {
    const rows = await this.db
      .insert(commentReactions)
      .values({
        commentId,
        userId,
        type,
      })
      .onConflictDoNothing()
      .returning({ id: commentReactions.id });

    return rows.length > 0;
  }

  /**
   * Thêm hoặc cập nhật cảm xúc cho bình luận (Idempotent Upsert).
   */
  async upsert(
    commentId: string,
    userId: string,
    type: CommentReactionType = 'like',
  ): Promise<CommentReactionRecord> {
    const [result] = await this.db
      .insert(commentReactions)
      .values({
        commentId,
        userId,
        type,
      })
      .onConflictDoUpdate({
        target: [commentReactions.commentId, commentReactions.userId],
        set: {
          type,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!result) throw new Error('Không thể cập nhật cảm xúc bình luận');
    return result;
  }

  /**
   * Hủy cảm xúc của người dùng trên bình luận.
   */
  async delete(commentId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      )
      .returning();

    return deleted.length > 0;
  }

  /**
   * Lấy cảm xúc của user đối với bình luận cụ thể.
   */
  async findByCommentAndUser(
    commentId: string,
    userId: string,
  ): Promise<CommentReactionRecord | null> {
    const [record] = await this.db
      .select()
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  /**
   * Lấy danh sách ID các bình luận mà user đã thả tim (phục vụ batch check trong list comments).
   */
  async findLikedCommentIdsByUser(
    userId: string,
    commentIds: string[],
  ): Promise<Set<string>> {
    if (!commentIds.length) return new Set();

    const rows = await this.db
      .select({ commentId: commentReactions.commentId })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.userId, userId),
          inArray(commentReactions.commentId, commentIds),
        ),
      );

    return new Set(rows.map((r) => r.commentId));
  }

  /**
   * Đếm tổng số lượt tim của một bình luận.
   */
  async countByCommentId(commentId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(commentReactions)
      .where(eq(commentReactions.commentId, commentId));

    return row?.count ?? 0;
  }
}
