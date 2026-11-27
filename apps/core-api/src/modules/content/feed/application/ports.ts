import type { TripAttachmentData } from '../../db/schema/posts.js';
import type { TrendSignal } from '../domain/trend-signal.js';
import type { FeedCursor } from '../domain/feed-cursor.js';

export const FEED_STORE = Symbol('FEED_STORE');
export const FEED_PAGE_CACHE = Symbol('FEED_PAGE_CACHE');
/** Hàm trả số trong [0, 1) để chọn seed thứ tự feed; mặc định Math.random. */
export const FEED_RANDOM = Symbol('FEED_RANDOM');

export interface FeedPostRow {
  id: string;
  authorId: string;
  title: string;
  body: string;
  hashtags: string[];
  mediaIds: string[];
  tripAttachment: TripAttachmentData | null;
  /** Người đăng đã đi đúng chuyến của lộ trình (đơn đã trả, đã kết thúc) lúc đăng bài. */
  isVerified?: boolean;
  reactionTotal: number;
  commentCount: number;
  bookmarkCount: number;
  shareCount: number;
  cursorAt: string;
  /** Điểm Hot trong trend_scores (TF111); chỉ listHotPosts trả. */
  hotScore?: number;
}

export interface FeedListQuery {
  limit: number;
  after: FeedCursor | null;
  authorId?: string;
}

/** Truy vấn có thứ tự ngẫu nhiên theo seed (feed-rank.ts). */
export interface RankedFeedListQuery extends FeedListQuery {
  seed: number;
}

export interface FeedStore {
  /** Bài công khai đã đăng, có ít nhất một video phát được, mới nhất trước (trang tác giả tab for_you). */
  listPlayablePosts(query: FeedListQuery): Promise<FeedPostRow[]>;
  /** Cùng điều kiện lọc với listPlayablePosts nhưng chỉ bài có trong trend_scores, xếp theo điểm Hot giảm dần; bằng điểm thì ngẫu nhiên theo seed. */
  listHotPosts(query: RankedFeedListQuery): Promise<FeedPostRow[]>;
  /** Cùng điều kiện lọc và thứ tự với listPlayablePosts nhưng chỉ bài người dùng đã lưu. */
  listSavedPlayablePosts(query: FeedListQuery & { userId: string }): Promise<FeedPostRow[]>;
  /** Cùng điều kiện lọc với listPlayablePosts nhưng chỉ các bài trong `postIds`; không theo thứ tự nào, bài không xem được thì không có. */
  findPlayablePostsByIds(postIds: string[]): Promise<FeedPostRow[]>;
  findLikedPostIds(userId: string, postIds: string[]): Promise<string[]>;
  findSavedPostIds(userId: string, postIds: string[]): Promise<string[]>;
}

/** Phần trang feed giống nhau với mọi người xem (chưa có viewerState). */
export interface SharedFeedPage<Card> {
  items: Card[];
  nextCursor: string | null;
}

/** Cache trang đầu feed dùng chung giữa các bản core-api. Lỗi thì ném ra; FeedUseCases tự quay về đọc database. */
export interface FeedPageCache {
  get<Card>(key: string): Promise<SharedFeedPage<Card> | null>;
  set<Card>(key: string, page: SharedFeedPage<Card>, ttlSeconds: number): Promise<void>;
}

export const TREND_SIGNAL_STORE = Symbol('TREND_SIGNAL_STORE');

/** Bảng content.trend_signals (TF111): lượt xem đủ và bấm đặt cho điểm Hot. */
export interface TrendSignalStore {
  /**
   * Ghi một tín hiệu. Trả false khi không ghi: người đó đã có tín hiệu cùng loại trên bài (kể cả khi sự kiện
   * được giao lại), hoặc bài không còn trong content.posts.
   */
  record(signal: TrendSignal): Promise<boolean>;
  /** Xoá tối đa `limit` tín hiệu có occurred_at trước `before`; trả số dòng đã xoá. */
  purgeOlderThan(before: Date, limit: number): Promise<number>;
}

export const TREND_SCORE_STORE = Symbol('TREND_SCORE_STORE');

/** Bài được chấm điểm Hot, kèm tổng tín hiệu sau bán rã do database cộng sẵn. */
export interface HotCandidateRow {
  postId: string;
  mediaIds: string[];
  coverMediaId: string | null;
  body: string;
  hashtags: string[];
  tripAttachment: TripAttachmentData | null;
  /** Σ trọng số × 0,5^(tuổi / 48h) của thích, bình luận, lưu, xem đủ, bấm đặt; không tính tương tác của chính tác giả. */
  decayedSignal: number;
}

export interface TrendScoreRow {
  postId: string;
  score: number;
  raw: number;
  decayedSignal: number;
  completeness: number;
}

/** Bảng content.trend_scores (TF111). */
export interface TrendScoreStore {
  /** Bài video công khai đã đăng sau `since`, tín hiệu tính bán rã tới `now`. */
  listHotCandidates(query: { now: Date; since: Date }): Promise<HotCandidateRow[]>;
  /** Thay cả bảng bằng `rows`: bài không có trong `rows` bị xoá điểm. Bài đã bị xoá khỏi posts thì bỏ qua. */
  replaceScores(rows: TrendScoreRow[], computedAt: Date): Promise<void>;
  findScores(postIds: string[]): Promise<Array<{ postId: string; score: number; computedAt: string }>>;
}
