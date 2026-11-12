import type { Db } from '@tripflix/db';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { bookmarks, mediaAssets, posts, reactions, renditions } from '../../db/schema/index.js';
import type { FeedCursor } from '../domain/feed-cursor.js';
import { HOT_SCORE_WEIGHTS, HOT_WINDOW_DAYS } from '../domain/hot-score.js';
import type { FeedPostRow, FeedStore } from '../application/ports.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

function newestFirstCursor(after: FeedCursor | null): SQL | undefined {
  return after ? sql`(${posts.createdAt}, ${posts.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined;
}

export class DrizzleFeedStore implements FeedStore {
  constructor(private readonly getDb: () => Db) {}

  private get db(): Db {
    return this.getDb();
  }

  listPlayablePosts({ limit, after }: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]> {
    return this.selectPlayablePosts({
      limit,
      cursorFilter: newestFirstCursor(after),
      orderBy: [desc(posts.createdAt), desc(posts.id)],
    });
  }

  listSavedPlayablePosts({
    userId,
    limit,
    after,
  }: {
    userId: string;
    limit: number;
    after: FeedCursor | null;
  }): Promise<FeedPostRow[]> {
    const savedByUser = sql`exists (
      select 1 from ${bookmarks}
      where ${bookmarks.postId} = ${posts.id} and ${bookmarks.userId} = ${userId}
    )`;
    return this.selectPlayablePosts({
      limit,
      cursorFilter: and(savedByUser, newestFirstCursor(after)),
      orderBy: [desc(posts.createdAt), desc(posts.id)],
    });
  }

  listHotPosts({ limit, after }: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]> {
    // Cùng công thức với calculateHotScore, cursor lấy điểm từ hàm đó.
    const hotScore = sql`(
      ${posts.reactionTotal} * ${HOT_SCORE_WEIGHTS.like}::int
      + ${posts.commentCount} * ${HOT_SCORE_WEIGHTS.comment}::int
      + ${posts.bookmarkCount} * ${HOT_SCORE_WEIGHTS.save}::int
      + ${posts.shareCount} * ${HOT_SCORE_WEIGHTS.share}::int
    )`;
    // Chỉ bài gần đây: index (status, visibility, created_at) quét đúng khoảng này thay vì chấm điểm mọi bài (100k bài mất ~1 giây).
    const recentOnly = sql`${posts.createdAt} > now() - make_interval(days => ${HOT_WINDOW_DAYS})`;
    return this.selectPlayablePosts({
      limit,
      cursorFilter: and(
        recentOnly,
        after?.score !== undefined
          ? sql`(${hotScore}, ${posts.createdAt}, ${posts.id}) < (${after.score}::int, ${after.at}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
      orderBy: [desc(hotScore), desc(posts.createdAt), desc(posts.id)],
    });
  }

  private selectPlayablePosts({
    limit,
    cursorFilter,
    orderBy,
  }: {
    limit: number;
    cursorFilter: SQL | undefined;
    orderBy: SQL[];
  }): Promise<FeedPostRow[]> {
    return this.db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        title: posts.title,
        body: posts.body,
        hashtags: posts.hashtags,
        mediaIds: posts.mediaIds,
        tripAttachment: posts.tripAttachment,
        reactionTotal: posts.reactionTotal,
        commentCount: posts.commentCount,
        bookmarkCount: posts.bookmarkCount,
        shareCount: posts.shareCount,
        cursorAt: sql<string>`to_char(${posts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(posts)
      .where(
        and(
          eq(posts.status, 'published'),
          eq(posts.visibility, 'public'),
          isNull(posts.deletedAt),
          // Feed là luồng Reels: bài viết (vlog) cũ lỡ kèm video cũng không được lọt vào.
          eq(posts.postType, 'video'),
          // Lọc ngay trong câu truy vấn để một trang không bị thiếu bài vì video chưa phát được.
          // So theo uuid để tra khoá chính media_assets; so theo chuỗi (id::text) thì mỗi bài quét cả bảng.
          // Mã không đúng dạng uuid coi như không có video, thay vì làm cả câu lỗi khi ép kiểu.
          sql`exists (
            select 1
            from jsonb_array_elements_text(${posts.mediaIds}) as post_media(id)
            join ${mediaAssets} on ${mediaAssets.id} = (
              case when post_media.id ~* ${UUID_PATTERN} then post_media.id::uuid end
            )
            join ${renditions} on ${renditions.assetId} = ${mediaAssets.id}
            where ${mediaAssets.status} = 'ready'
          )`,
          cursorFilter,
        ),
      )
      .orderBy(...orderBy)
      .limit(limit);
  }

  async findLikedPostIds(userId: string, postIds: string[]): Promise<string[]> {
    if (postIds.length === 0) return [];
    const rows = await this.db
      .select({ postId: reactions.postId })
      .from(reactions)
      .where(and(eq(reactions.userId, userId), inArray(reactions.postId, postIds)));
    return rows.map((row) => row.postId);
  }

  async findSavedPostIds(userId: string, postIds: string[]): Promise<string[]> {
    if (postIds.length === 0) return [];
    const rows = await this.db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.postId, postIds)));
    return rows.map((row) => row.postId);
  }
}
