import { eq } from 'drizzle-orm';
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

  async upsert(data: NewPostSummaryRecord): Promise<PostSummaryRecord> {
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
      })
      .returning();

    if (!saved) {
      throw new Error(`Không thể lưu tóm tắt cho bài đăng ${data.postId}`);
    }
    return saved;
  }
}
