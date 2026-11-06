import type { Db } from '@tripflix/db';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { bookmarks, mediaAssets, posts, reactions, renditions } from '../../db/schema/index.js';
import type { FeedCursor } from '../domain/feed-cursor.js';
import { HOT_SCORE_WEIGHTS } from '../domain/hot-score.js';
import type { FeedPostRow, FeedStore } from '../application/ports.js';

export class DrizzleFeedStore implements FeedStore {
  constructor(private readonly getDb: () => Db) {}

  private get db(): Db {
    return this.getDb();
  }

  listPlayablePosts({ limit, after }: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]> {
    return this.selectPlayablePosts({
      limit,
      cursorFilter: after ? sql`(${posts.createdAt}, ${posts.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined,
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
    return this.selectPlayablePosts({
      limit,
      cursorFilter:
        after?.score !== undefined
          ? sql`(${hotScore}, ${posts.createdAt}, ${posts.id}) < (${after.score}::int, ${after.at}::timestamptz, ${after.id}::uuid)`
          : undefined,
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
          // Lọc ngay trong câu truy vấn để một trang không bị thiếu bài vì video chưa phát được.
          sql`exists (
            select 1
            from jsonb_array_elements_text(${posts.mediaIds}) as post_media(id)
            join ${mediaAssets} on ${mediaAssets.id}::text = post_media.id
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
