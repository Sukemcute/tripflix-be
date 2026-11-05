import { eq, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  postSummaries,
  type NewPostSummaryRecord,
  type PostSummaryRecord,
} from '../../db/schema/index.js';

export class PostSummaryRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  async findByPostId(postId: string): Promise<PostSummaryRecord | null> {
    const [record] = await this.db
      .select()
      .from(postSummaries)
      .where(eq(postSummaries.postId, postId))
      .limit(1);
    return record ?? null;
  }

  /**
   * Ghi đè chỉ khi bản mới không cũ hơn bản trên đĩa (Atomic Compare-and-Swap ở tầng DB)
   * và một lần failed không xóa bản ready cũ.
   */
  async saveIfNewer(data: NewPostSummaryRecord): Promise<PostSummaryRecord> {
    const [saved] = await this.db
      .insert(postSummaries)
      .values(data)
      .onConflictDoUpdate({
        target: postSummaries.postId,
        set: {
          status: data.status,
          summary: data.summary,
          keyTakeaways: data.keyTakeaways,
          content: data.content,
          safety: data.safety,
          inputHash: data.inputHash,
          commentCountAtSummary: data.commentCountAtSummary,
          promptVersion: data.promptVersion,
          modelName: data.modelName,
          generatedAt: data.generatedAt,
          updatedAt: new Date(),
        },
        where: sql`(
          ${postSummaries.generatedAt} IS NULL
          OR excluded.generated_at >= ${postSummaries.generatedAt}
        ) AND NOT (
          ${postSummaries.status} = 'ready' AND excluded.status = 'failed'
        )`,
      })
      .returning();

    if (saved) return saved;

    const current = await this.findByPostId(data.postId);
    if (!current) {
      throw new Error(`Không thể lưu tóm tắt cho bài đăng ${data.postId}`);
    }
    return current;
  }

  async upsert(data: NewPostSummaryRecord): Promise<PostSummaryRecord> {
    return this.saveIfNewer(data);
  }
}
