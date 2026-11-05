import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
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
  keyword?: string;
}

export interface FindUserPostsOptions {
  authorId: string;
  limit: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
  status?: PostStatus | 'all';
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
    if (options.keyword) {
      const kw = `%${options.keyword}%`;
      conditions.push(or(ilike(posts.title, kw), ilike(posts.body, kw))!);
    }

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        or(
          lt(posts.createdAt, options.cursorCreatedAt),
          and(eq(posts.createdAt, options.cursorCreatedAt), lt(posts.id, options.cursorId)),
        )!,
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

    if (options.cursorCreatedAt && options.cursorId) {
      conditions.push(
        or(
          lt(posts.createdAt, options.cursorCreatedAt),
          and(eq(posts.createdAt, options.cursorCreatedAt), lt(posts.id, options.cursorId)),
        )!,
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
        or(
          lt(posts.createdAt, options.cursorCreatedAt),
          and(eq(posts.createdAt, options.cursorCreatedAt), lt(posts.id, options.cursorId)),
        )!,
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
   * Tăng/giảm nguyên tử (atomic) số lượng comment, share, bookmark.
   */
  async incrementCounter(
    id: string,
    field: 'commentCount' | 'shareCount' | 'bookmarkCount',
    delta: number,
  ): Promise<void> {
    const col =
      field === 'commentCount'
        ? posts.commentCount
        : field === 'shareCount'
          ? posts.shareCount
          : posts.bookmarkCount;

    await this.db
      .update(posts)
      .set({
        [field]: sql`GREATEST(0, ${col} + ${delta})`,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));
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
        or(
          gt(posts.updatedAt, options.cursorUpdatedAt),
          and(eq(posts.updatedAt, options.cursorUpdatedAt), gt(posts.id, options.cursorId)),
        )!,
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
