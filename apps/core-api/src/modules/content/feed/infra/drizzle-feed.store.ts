import type { Db } from '@tripflix/db';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { bookmarks, mediaAssets, posts, reactions, renditions, trendScores } from '../../db/schema/index.js';
import type { FeedCursor } from '../domain/feed-cursor.js';
import { FOR_YOU_AGE_OFFSET_HOURS, FOR_YOU_GRAVITY, FOR_YOU_SHUFFLE } from '../domain/feed-rank.js';
import { HOT_SCORE_WEIGHTS } from '../domain/hot-score.js';
import type { FeedListQuery, FeedPostRow, FeedStore, RankedFeedListQuery } from '../application/ports.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

function newestFirstCursor(after: FeedCursor | null): SQL | undefined {
  return after ? sql`(${posts.createdAt}, ${posts.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined;
}

/** Điểm tương tác theo bộ đếm của bài, chỉ còn dùng cho tab Dành cho bạn (tab hot đọc trend_scores từ TF111). */
const counterScore = sql`(
  ${posts.reactionTotal} * ${HOT_SCORE_WEIGHTS.like}::int
  + ${posts.commentCount} * ${HOT_SCORE_WEIGHTS.comment}::int
  + ${posts.bookmarkCount} * ${HOT_SCORE_WEIGHTS.save}::int
  + ${posts.shareCount} * ${HOT_SCORE_WEIGHTS.share}::int
)`;

/**
 * Số ngẫu nhiên cố định cho (seed, id bài), từ 0 tới 2^32 - 1: 32 bit đầu của md5.
 * Không dùng random() vì trang sau phải ra đúng thứ tự trang trước đã dùng.
 */
function seededTieBreak(seed: number, postId: SQL): SQL {
  return sql`('x' || substr(md5(${seed}::int::text || ':' || ${postId}::text), 1, 8))::bit(32)::bigint`;
}

export class DrizzleFeedStore implements FeedStore {
  constructor(private readonly getDb: () => Db) {}

  private get db(): Db {
    return this.getDb();
  }

  listPlayablePosts({ limit, after, authorId }: FeedListQuery): Promise<FeedPostRow[]> {
    return this.selectPlayablePosts({
      limit,
      authorId,
      cursorFilter: newestFirstCursor(after),
      orderBy: [desc(posts.createdAt), desc(posts.id)],
    });
  }

  listSavedPlayablePosts({
    userId,
    limit,
    after,
    authorId,
  }: FeedListQuery & { userId: string }): Promise<FeedPostRow[]> {
    const savedByUser = sql`exists (
      select 1 from ${bookmarks}
      where ${bookmarks.postId} = ${posts.id} and ${bookmarks.userId} = ${userId}
    )`;
    return this.selectPlayablePosts({
      limit,
      authorId,
      cursorFilter: and(savedByUser, newestFirstCursor(after)),
      orderBy: [desc(posts.createdAt), desc(posts.id)],
    });
  }

  listForYouPosts({ limit, after, authorId, seed, asOf }: RankedFeedListQuery & { asOf: string }): Promise<FeedPostRow[]> {
    const ageHours = sql`greatest(0, extract(epoch from (${asOf}::timestamptz - ${posts.createdAt})) / 3600)`;
    // ponytail: chấm điểm mọi bài phát được mỗi lần đọc; đủ cho pilot (vài nghìn bài).
    // Nhiều bài hơn thì chuyển sang điểm tính sẵn theo lô (giống recommend_post_scores) hoặc giới hạn cửa sổ ngày.
    // Số ngẫu nhiên [0, 1) cố định theo (seed, id bài), nên sang trang vẫn ra đúng điểm trang trước đã dùng.
    const seededUnit = sql`(${seededTieBreak(seed, sql`${posts.id}`)} / 4294967296.0::float8)`;
    const rank = sql<number>`(
      ln(2 + ${counterScore}) / power(${ageHours} + ${FOR_YOU_AGE_OFFSET_HOURS}::float8, ${FOR_YOU_GRAVITY}::float8)
        * exp(${FOR_YOU_SHUFFLE}::float8 * (2 * ${seededUnit} - 1))
    )::float8`;
    return this.selectPlayablePosts({
      limit,
      authorId,
      cursorFilter:
        after?.rank !== undefined ? sql`(${rank}, ${posts.id}) < (${after.rank}::float8, ${after.id}::uuid)` : undefined,
      orderBy: [sql`${rank} desc`, desc(posts.id)],
      rank,
    });
  }

  listHotPosts({ limit, after, authorId, seed }: RankedFeedListQuery): Promise<FeedPostRow[]> {
    // Điểm do job chấm sẵn mỗi 5 phút (TF111), chỉ có cho bài video đăng trong 30 ngày: bài ngoài bảng không vào tab hot.
    // Nối thẳng trend_scores để chỉ xét chừng nghìn bài có điểm: lấy điểm bằng truy vấn con cho mọi bài trong posts
    // mất 80 đến 110 ms ở 9.978 bài, nối thì khoảng 1 ms (đo trạng thái B ngày 20/11).
    const tieBreak = seededTieBreak(seed, sql`${posts.id}`);
    return this.selectPlayablePosts({
      limit,
      authorId,
      cursorFilter:
        after?.score !== undefined
          ? sql`(${trendScores.score}, ${tieBreak}, ${posts.id}) < (${after.score}::float8, ${seededTieBreak(seed, sql`${after.id}::uuid`)}, ${after.id}::uuid)`
          : undefined,
      orderBy: [desc(trendScores.score), sql`${tieBreak} desc`, desc(posts.id)],
      isHotOnly: true,
    });
  }

  async findPlayablePostsByIds(postIds: string[]): Promise<FeedPostRow[]> {
    if (postIds.length === 0) return [];
    return this.selectPlayablePosts({
      limit: postIds.length,
      cursorFilter: inArray(posts.id, postIds),
      orderBy: [desc(posts.id)],
    });
  }

  private selectPlayablePosts({
    limit,
    authorId,
    cursorFilter,
    orderBy,
    rank,
    isHotOnly = false,
  }: {
    limit: number;
    authorId?: string;
    cursorFilter: SQL | undefined;
    orderBy: SQL[];
    rank?: SQL<number>;
    /** Chỉ bài có trong trend_scores, kèm điểm Hot. */
    isHotOnly?: boolean;
  }): Promise<FeedPostRow[]> {
    const query = this.db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        title: posts.title,
        body: posts.body,
        hashtags: posts.hashtags,
        mediaIds: posts.mediaIds,
        tripAttachment: posts.tripAttachment,
        isVerified: posts.isVerified,
        reactionTotal: posts.reactionTotal,
        commentCount: posts.commentCount,
        bookmarkCount: posts.bookmarkCount,
        shareCount: posts.shareCount,
        cursorAt: sql<string>`to_char(${posts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        ...(rank ? { rank: rank.mapWith(Number) } : {}),
        ...(isHotOnly ? { hotScore: trendScores.score } : {}),
      })
      .from(posts)
      .$dynamic();
    return (isHotOnly ? query.innerJoin(trendScores, eq(trendScores.postId, posts.id)) : query)
      .where(
        and(
          eq(posts.status, 'published'),
          eq(posts.visibility, 'public'),
          authorId ? eq(posts.authorId, authorId) : undefined,
          isNull(posts.deletedAt),
          // Feed là luồng Reels: bài viết (vlog) cũ lỡ kèm video cũng không được lọt vào.
          eq(posts.postType, 'video'),
          // Lọc ngay trong câu truy vấn để một trang không bị thiếu bài vì video chưa phát được.
          // So theo uuid để tra khoá chính media_assets; so theo chuỗi (id::text) thì mỗi bài quét cả bảng.
          // Mã không đúng dạng uuid coi như không có video, thay vì làm cả câu lỗi khi ép kiểu.
          // media_ids không phải mảng (13/11 staging có bài lưu chuỗi "uuid") cũng coi như không có video:
          // jsonb_array_elements_text gặp chuỗi là lỗi cả câu, một bài sai làm hỏng feed của mọi người.
          sql`exists (
            select 1
            from jsonb_array_elements_text(
              case when jsonb_typeof(${posts.mediaIds}) = 'array' then ${posts.mediaIds} else '[]'::jsonb end
            ) as post_media(id)
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
