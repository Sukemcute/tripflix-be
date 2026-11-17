import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, getTableConfig } from 'drizzle-orm/pg-core';
import type { Db } from '@tripflix/db';
import { isBeforeCursor } from './keyset-cursor.js';
import { commentReactions, comments, type CommentRecord, type NewCommentRecord } from '../../db/schema/index.js';

export type SampledCommentRecord = CommentRecord & {
  parentCommentBody: string | null;
};

export type CommentPageRecord = CommentRecord & {
  replyCount: number;
  isLiked: boolean;
};

export interface FindCommentsOptions {
  postId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  parentCommentId?: string;
  flat?: boolean;
  viewerId?: string;
  isStaff?: boolean;
}

export interface CountCommentsOptions {
  flat?: boolean;
  parentCommentId?: string;
  viewerId?: string;
  isStaff?: boolean;
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

  async findByIdForUpdate(id: string): Promise<CommentRecord | null> {
    const [record] = await this.db.select().from(comments).where(eq(comments.id, id)).for('update');
    return record ?? null;
  }

  async findVisibleIds(postId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const records = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          inArray(comments.id, ids),
          eq(comments.status, 'visible'),
          isNull(comments.deletedAt),
        ),
      );
    return records.map((row) => row.id);
  }

  async hasUnavailableSince(postId: string, since: Date): Promise<boolean> {
    const [record] = await this.db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          gt(comments.updatedAt, since),
          or(ne(comments.status, 'visible'), sql`${comments.deletedAt} IS NOT NULL`),
        ),
      )
      .limit(1);
    return Boolean(record);
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
      .where(and(or(eq(comments.id, id), eq(comments.parentCommentId, id)), isNull(comments.deletedAt)))
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
          or(gt(comments.createdAt, since), and(eq(comments.isEdited, true), gt(comments.updatedAt, since))),
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
  private readableStatus(viewerId?: string, isStaff = false) {
    return or(eq(comments.status, 'visible'), and(eq(comments.status, 'held'),
      isStaff ? sql`true` : viewerId ? eq(comments.authorId, viewerId) : sql`false`))!;
  }

  async holdWithVisibleReplies(id: string, isRoot: boolean): Promise<number> {
    const marker = randomUUID();
    const rows = await this.db.update(comments).set({
      status: 'held', hiddenByActionId: marker, updatedAt: new Date(),
    }).where(and(
      isRoot ? or(eq(comments.id, id), eq(comments.parentCommentId, id)) : eq(comments.id, id),
      eq(comments.status, 'visible'), isNull(comments.deletedAt),
    )).returning({ id: comments.id });
    if (isRoot) await this.db.update(comments).set({ cascadeRootCommentId: id })
      .where(and(eq(comments.parentCommentId, id), eq(comments.hiddenByActionId, marker)));
    return rows.length;
  }

  private pageConditions(options: FindCommentsOptions): SQL[] {
    const conditions = [
      eq(comments.postId, options.postId),
      isNull(comments.deletedAt),
      this.readableStatus(options.viewerId, options.isStaff),
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
        isBeforeCursor(comments, comments.createdAt, comments.id, { time: options.cursorCreatedAt, id: options.cursorId }),
      );
    }
    return conditions;
  }

  async findByPostId(options: FindCommentsOptions): Promise<CommentRecord[]> {
    return this.db
      .select()
      .from(comments)
      .where(and(...this.pageConditions(options)))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(options.limit);
  }

  /**
   * Một trang bình luận kèm số trả lời còn hiển thị và người xem đã thích chưa, trong một câu truy vấn.
   * Thay cho ba lượt gọi DB nối tiếp (trang, lượt thích, đếm trả lời): mỗi lượt tốn CPU của core-api dù Postgres trả rất nhanh.
   */
  async findPage(options: FindCommentsOptions): Promise<CommentPageRecord[]> {
    // Drizzle có lúc in cột của bảng chính không kèm tên bảng ("id"): trong câu con, "id" sẽ trỏ nhầm vào bảng con.
    // Ghi đủ schema.bảng.cột để câu con luôn trỏ về dòng của trang.
    const { schema, name } = getTableConfig(comments);
    const pageCommentId = sql`${sql.identifier(schema ?? 'public')}.${sql.identifier(name)}.${sql.identifier(comments.id.name)}`;
    // Cùng điều kiện với countRepliesByParentIds: chỉ đếm trả lời còn hiển thị.
    const replyCount = sql<number>`(
      SELECT count(*)::int FROM ${comments} AS reply
      WHERE reply.parent_comment_id = ${pageCommentId} AND reply.deleted_at IS NULL AND reply.status = 'visible'
    )`;
    const isLiked = options.viewerId
      ? sql<boolean>`EXISTS (
          SELECT 1 FROM ${commentReactions} AS liked
          WHERE liked.comment_id = ${pageCommentId} AND liked.user_id = ${options.viewerId}
        )`
      : sql<boolean>`false`;

    return this.db
      .select({ ...getTableColumns(comments), replyCount, isLiked })
      .from(comments)
      .where(and(...this.pageConditions(options)))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(options.limit);
  }

  /**
   * Đếm số lượng bình luận phù hợp theo điều kiện phân trang.
   * - flat = true: đếm toàn bộ bình luận của bài (gốc + phản hồi).
   * - parentCommentId: đếm số phản hồi con của bình luận cha.
   * - Mặc định: đếm số bình luận gốc (parentCommentId IS NULL).
   */
  /** Số trả lời còn hiển thị của từng bình luận, một truy vấn cho cả trang. Bình luận không có trả lời thì không có trong Map. */
  async countRepliesByParentIds(parentIds: string[]): Promise<Map<string, number>> {
    if (parentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ parentCommentId: comments.parentCommentId, count: sql<number>`count(*)::int` })
      .from(comments)
      .where(
        and(
          inArray(comments.parentCommentId, parentIds),
          isNull(comments.deletedAt),
          eq(comments.status, 'visible'),
        ),
      )
      .groupBy(comments.parentCommentId);
    return new Map(rows.flatMap((row) => (row.parentCommentId ? [[row.parentCommentId, row.count] as const] : [])));
  }

  async countByPostId(postId: string, options?: CountCommentsOptions): Promise<number> {
    const conditions = [
      eq(comments.postId, postId),
      isNull(comments.deletedAt),
      this.readableStatus(options?.viewerId, options?.isStaff),
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

  /**
   * Lấy mẫu ngẫu nhiên có kiểm soát các bình luận visible của bài viết (Deterministic Pseudo-Random Sampling).
   * Phục vụ AI summary phân tích chịu tải trên bài viết nhiều bình luận (TF14/TF33).
   * Dùng hashtext(id::text || seed) trong Postgres để đảm bảo tính tái lập và query trúng index,
   * tuyệt đối không dùng ORDER BY random() để tránh full table scan.
   */
  async sampleComments(options: { postId: string; size: number; seed?: string }): Promise<SampledCommentRecord[]> {
    const conditions = [
      eq(comments.postId, options.postId),
      isNull(comments.deletedAt),
      eq(comments.status, 'visible'),
    ];

    const orderClauses = options.seed
      ? [sql`hashtext(${comments.id}::text || ${options.seed})`, comments.id]
      : [sql`hashtext(${comments.id}::text)`, comments.id];

    const parentComments = alias(comments, 'parent_comments');

    const rows = await this.db
      .select({
        comment: comments,
        parentCommentBody: parentComments.body,
      })
      .from(comments)
      .leftJoin(
        parentComments,
        and(
          eq(comments.parentCommentId, parentComments.id),
          isNull(parentComments.deletedAt),
          eq(parentComments.status, 'visible'),
        ),
      )
      .where(and(...conditions))
      .orderBy(...orderClauses)
      .limit(options.size);

    return rows.map((r) => ({
      ...r.comment,
      parentCommentBody: r.parentCommentBody ?? null,
    }));
  }

  /**
   * Lấy thống kê số bình luận visible và số người viết khác nhau (unique authors).
   * Phục vụ suy luận thống kê mẫu (Population Estimation / Confidence Interval) của AI Summary.
   */
  async getCommentStats(postId: string): Promise<{ visibleCommentCount: number; uniqueAuthorCount: number }> {
    const [row] = await this.db
      .select({
        visibleCommentCount: sql<number>`count(*)::int`,
        uniqueAuthorCount: sql<number>`count(distinct ${comments.authorId})::int`,
      })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          isNull(comments.deletedAt),
          eq(comments.status, 'visible'),
        ),
      );

    return {
      visibleCommentCount: row?.visibleCommentCount ?? 0,
      uniqueAuthorCount: row?.uniqueAuthorCount ?? 0,
    };
  }
}
