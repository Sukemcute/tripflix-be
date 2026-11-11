import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { postSummaries, type NewPostSummaryRecord, type PostSummaryRecord } from '../../db/schema/index.js';

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
   * Tìm danh sách các bài viết có tóm tắt đang bị giữ lại (held) do nguồn bị ẩn hoặc xóa (Reconciliation).
   * Phục vụ worker AI đối soát bù khi Redis stream bị rụng hoặc quá tải (TF33).
   */
  async findHeldSummaryPostIds(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ postIds: string[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 50;
    const cursor = options?.cursor;

    const conditions = [
      sql`${postSummaries.sourceCommentIds} IS NOT NULL`,
      sql`jsonb_array_length(${postSummaries.sourceCommentIds}) > 0`,
      sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${postSummaries.sourceCommentIds}) AS src(id)
        LEFT JOIN content.comments c
          ON src.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND c.id = src.id::uuid
        WHERE c.id IS NULL OR c.status != 'visible' OR c.deleted_at IS NOT NULL
      )`,
    ];

    if (cursor && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) {
      conditions.push(sql`${postSummaries.postId} > ${cursor}::uuid`);
    }

    const rows = await this.db
      .select({ postId: postSummaries.postId })
      .from(postSummaries)
      .where(and(...conditions))
      .orderBy(postSummaries.postId)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const postIds = items.map((r) => r.postId);
    const nextCursor = hasMore ? (items[items.length - 1]?.postId ?? null) : null;

    return { postIds, nextCursor };
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
          sourceCommentIds: data.sourceCommentIds ?? null,
          commentCountAtSummary: data.commentCountAtSummary,
          promptVersion: data.promptVersion,
          modelName: data.modelName,
          generatedAt: data.generatedAt,
          updatedAt: new Date(),
        },
        where: sql`(
          ${postSummaries.generatedAt} IS NULL
          OR excluded.generated_at > ${postSummaries.generatedAt}
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
