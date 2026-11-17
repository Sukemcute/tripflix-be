import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { isAfterCursor, isBeforeCursor } from './keyset-cursor.js';
import {
  postCounterDeltas,
  posts,
  type NewPostRecord,
  type PostRecord,
  type PostStatus,
  type PostType,
} from '../../db/schema/index.js';

export interface FindPostsForSyncOptions {
  limit: number;
  updatedAfter?: Date;
  cursorUpdatedAt?: Date;
  cursorId?: string;
}

export interface FindPublicPostsOptions {
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  authorId?: string;
  postType?: PostType;
  hashtag?: string;
}

export interface FindUserPostsOptions {
  authorId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  status?: PostStatus | 'all';
  postType?: PostType;
}

export interface FindAdminPostsOptions {
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  status?: PostStatus;
  authorId?: string;
}

/**
 * Repository thao tác với bảng content.posts qua Drizzle ORM.
 * Hỗ trợ executor động để tự động tham gia @Transactional('content').
 */
export type PostCounterField = 'commentCount' | 'shareCount' | 'bookmarkCount';

export type CounterLockResult =
  | { status: 'locked'; post: PostRecord }
  | { status: 'busy' }
  | { status: 'missing' };

export class PostRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  async create(data: NewPostRecord): Promise<PostRecord> {
    const [inserted] = await this.db.insert(posts).values(data).returning();
    if (!inserted) throw new Error('Không thể tạo bài đăng');
    return inserted;
  }

  async findById(id: string): Promise<PostRecord | null> {
    const [record] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return record ?? null;
  }

  /**
   * Khóa bi quan dòng post (SELECT ... FOR UPDATE) để tuần tự hóa các cập nhật tương tác đồng thời.
   */
  async findByIdForUpdate(id: string): Promise<PostRecord | null> {
    const [record] = await this.db.select().from(posts).where(eq(posts.id, id)).for('update');
    return record ?? null;
  }

  async findByIds(ids: string[]): Promise<PostRecord[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(posts).where(inArray(posts.id, ids));
  }

  async update(id: string, data: Partial<NewPostRecord>): Promise<PostRecord> {
    const [updated] = await this.db
      .update(posts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();
    if (!updated) throw new Error(`Không thể cập nhật bài đăng với ID: ${id}`);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(posts)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  /** Tổng cảm xúc trên các bài công khai của tác giả (cùng điều kiện với GET /v1/posts?author_id=). */
  async sumPublicReactions(authorId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${posts.reactionTotal})` })
      .from(posts)
      .where(and(eq(posts.authorId, authorId), eq(posts.status, 'published'), eq(posts.visibility, 'public'),
        sql`${posts.deletedAt} IS NULL`));
    return Number(row?.total ?? 0);
  }

  /**
   * Truy vấn bảng tin công khai với Keyset Cursor Pagination (created_at DESC, id DESC).
   */
  async findPublicPosts(options: FindPublicPostsOptions): Promise<PostRecord[]> {
    const conditions = [
      eq(posts.status, 'published'),
      eq(posts.visibility, 'public'),
    ];

    if (options.authorId) {
      conditions.push(eq(posts.authorId, options.authorId));
    }
    if (options.postType) {
      conditions.push(eq(posts.postType, options.postType));
    }
    if (options.hashtag) {
      conditions.push(sql`${posts.hashtags} @> ${JSON.stringify([options.hashtag])}::jsonb`);
    }

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        isBeforeCursor(posts, posts.createdAt, posts.id, { time: options.cursorCreatedAt, id: options.cursorId }),
      );
    }

    return this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(options.limit);
  }

  /**
   * Lấy danh sách bài đăng và bản nháp của một người dùng.
   */
  async findUserPosts(options: FindUserPostsOptions): Promise<PostRecord[]> {
    const conditions = [eq(posts.authorId, options.authorId)];

    if (options.status && options.status !== 'all') {
      conditions.push(eq(posts.status, options.status));
    } else {
      conditions.push(sql`${posts.status} != 'deleted'`);
    }
    if (options.postType) {
      conditions.push(eq(posts.postType, options.postType));
    }

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        isBeforeCursor(posts, posts.createdAt, posts.id, { time: options.cursorCreatedAt, id: options.cursorId }),
      );
    }

    return this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(options.limit);
  }

  /**
   * Lấy danh sách bài đăng phục vụ Admin/Moderator kiểm duyệt.
   */
  async findAdminPosts(options: FindAdminPostsOptions): Promise<PostRecord[]> {
    const conditions = [];

    if (options.status) {
      conditions.push(eq(posts.status, options.status));
    }
    if (options.authorId) {
      conditions.push(eq(posts.authorId, options.authorId));
    }
    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        isBeforeCursor(posts, posts.createdAt, posts.id, { time: options.cursorCreatedAt, id: options.cursorId }),
      );
    }

    return this.db
      .select()
      .from(posts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(options.limit);
  }

  /**
   * Đếm tổng số bài viết trong danh sách quản trị (phục vụ phân trang tổng hợp).
   */
  async countAdminPosts(options: { status?: PostStatus; authorId?: string }): Promise<number> {
    const conditions = [];
    if (options.status) conditions.push(eq(posts.status, options.status));
    if (options.authorId) conditions.push(eq(posts.authorId, options.authorId));

    const [result] = await this.db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(posts)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return result?.count ?? 0;
  }

  /**
   * Tăng/giảm nguyên tử (atomic) số lượng comment, share, bookmark. Trả về số mới (không có bài thì undefined).
   */
  async incrementCounter(
    id: string,
    field: PostCounterField,
    delta: number,
  ): Promise<number | undefined> {
    if (field === 'commentCount') return this.changeCommentCount(id, delta);
    const record = await this.lockAndIncrementCounter(id, field, delta);
    return record?.[field];
  }

  /**
   * Đổi comment_count kèm gộp luôn phần "+1" còn trong bảng đệm của bài (TF99). Trừ thẳng khi phần đệm chưa cộng
   * thì GREATEST(0, …) chặn số về 0, job cộng dồn cộng phần đệm sau đó làm số lệch lên (xoá gốc cùng 8 trả lời vừa
   * gửi lúc bài đông: còn 0 bình luận mà số đếm là 8). Người gọi giữ khoá dòng bài nên các lượt thêm bình luận
   * đang dở đã commit phần đệm của chúng; job cộng dồn khoá dòng bài trước khi lấy phần đệm nên không khoá chết.
   */
  private async changeCommentCount(id: string, delta: number): Promise<number | undefined> {
    const result = await this.db.execute<{ comment_count: number }>(sql`
      WITH pending AS (
        DELETE FROM ${postCounterDeltas} WHERE ${postCounterDeltas.postId} = ${id}
        RETURNING ${postCounterDeltas.commentDelta} AS comment_delta
      )
      UPDATE ${posts}
      SET comment_count = GREATEST(0, comment_count + (SELECT coalesce(sum(comment_delta), 0) FROM pending)::int + ${delta}),
          updated_at = now()
      WHERE ${posts.id} = ${id}
      RETURNING comment_count
    `);
    return result.rows[0]?.comment_count;
  }

  /**
   * Như lockAndIncrementCounter nhưng không chờ (TF99): dòng bài đang bị người khác giữ (bài đông) thì trả `busy`
   * ngay để lượt thêm bình luận ghi vào bảng đệm thay vì xếp hàng. FOR NO KEY UPDATE không xung đột với khoá nhẹ
   * (KEY SHARE) mà khoá ngoại của các lượt INSERT bình luận đang giữ, nên chỉ "bận" khi có người đang cộng đếm,
   * sửa bài hoặc kiểm duyệt.
   */
  async tryLockAndIncrementCounter(id: string, field: PostCounterField, delta: number): Promise<CounterLockResult> {
    const [record] = await this.db
      .update(posts)
      .set({
        [field]: sql`GREATEST(0, ${posts[field]} + ${delta})`,
        updatedAt: new Date(),
      })
      .where(
        eq(
          posts.id,
          sql`(SELECT locked.id FROM ${posts} AS locked WHERE locked.id = ${id} FOR NO KEY UPDATE SKIP LOCKED)`,
        ),
      )
      .returning();
    if (record) return { status: 'locked', post: record };
    return (await this.findById(id)) ? { status: 'busy' } : { status: 'missing' };
  }

  /**
   * Khoá dòng bài và cộng bộ đếm trong cùng một câu (UPDATE … RETURNING): dùng làm câu đầu transaction
   * thay cho SELECT … FOR UPDATE rồi UPDATE, bớt một lượt gọi DB trong lúc giữ khoá (TF99).
   */
  async lockAndIncrementCounter(id: string, field: PostCounterField, delta: number): Promise<PostRecord | null> {
    const [record] = await this.db
      .update(posts)
      .set({
        [field]: sql`GREATEST(0, ${posts[field]} + ${delta})`,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();
    return record ?? null;
  }

  /**
   * Cập nhật số đếm cảm xúc tổng hợp.
   */
  async updateReactionCounts(
    id: string,
    reactionCounts: Record<string, number>,
    reactionTotal: number,
  ): Promise<void> {
    await this.db
      .update(posts)
      .set({
        reactionCounts,
        reactionTotal,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
  }

  /**
   * Truy vấn danh sách bài viết công khai phục vụ đồng bộ dữ liệu (Sync / Indexing)
   * theo thứ tự updatedAt ASC, id ASC với keyset cursor.
   */
  async findPostsForSync(options: FindPostsForSyncOptions): Promise<PostRecord[]> {
    const conditions = [
      eq(posts.status, 'published'),
      eq(posts.visibility, 'public'),
      sql`${posts.deletedAt} IS NULL`,
    ];

    if (options.updatedAfter) {
      conditions.push(gte(posts.updatedAt, options.updatedAfter));
    }

    if (options.cursorUpdatedAt && options.cursorId) {
      conditions.push(
        isAfterCursor(posts, posts.updatedAt, posts.id, { time: options.cursorUpdatedAt, id: options.cursorId }),
      );
    }

    return this.db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(asc(posts.updatedAt), asc(posts.id))
      .limit(options.limit);
  }
}
