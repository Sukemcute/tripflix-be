import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  reactions,
  type ReactionRecord,
  type ReactionType,
} from '../../db/schema/index.js';

export class ReactionRepository {
  constructor(private readonly db: Db) {}

  /**
   * Thêm hoặc đổi cảm xúc (Idempotent Upsert).
   */
  async upsert(postId: string, userId: string, type: ReactionType): Promise<ReactionRecord> {
    const [result] = await this.db
      .insert(reactions)
      .values({
        postId,
        userId,
        type,
      })
      .onConflictDoUpdate({
        target: [reactions.postId, reactions.userId],
        set: {
          type,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!result) throw new Error('Không thể cập nhật cảm xúc');
    return result;
  }

  /**
   * Hủy cảm xúc của người dùng trên bài viết.
   */
  async delete(postId: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(reactions)
      .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)))
      .returning();

    return deleted.length > 0;
  }

  async findByPostAndUser(postId: string, userId: string): Promise<ReactionRecord | null> {
    const [record] = await this.db
      .select()
      .from(reactions)
      .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)))
      .limit(1);

    return record ?? null;
  }

  /**
   * Tổng hợp số lượng từng loại cảm xúc trên bài đăng.
   */
  async aggregateReactionCounts(postId: string): Promise<{
    reactionCounts: Record<string, number>;
    reactionTotal: number;
  }> {
    const rows = await this.db
      .select({
        type: reactions.type,
        count: sql<number>`count(*)::int`,
      })
      .from(reactions)
      .where(eq(reactions.postId, postId))
      .groupBy(reactions.type);

    const reactionCounts: Record<string, number> = {};
    let reactionTotal = 0;

    for (const row of rows) {
      reactionCounts[row.type] = row.count;
      reactionTotal += row.count;
    }

    return { reactionCounts, reactionTotal };
  }
}
