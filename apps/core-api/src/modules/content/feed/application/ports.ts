import type { TripAttachmentData } from '../../db/schema/posts.js';
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
  reactionTotal: number;
  commentCount: number;
  bookmarkCount: number;
  shareCount: number;
  cursorAt: string;
  /** Điểm xếp hạng tab Dành cho bạn (feed-rank.ts); chỉ listForYouPosts trả. */
  rank?: number;
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
  /**
   * Tab Dành cho bạn: cùng điều kiện lọc với listPlayablePosts, xếp theo điểm có bán rã tính tới `asOf`;
   * bài chưa có tương tác nhận điểm ngẫu nhiên theo seed. Trả kèm `rank` của từng bài cho cursor.
   */
  listForYouPosts(query: RankedFeedListQuery & { asOf: string }): Promise<FeedPostRow[]>;
  /** Bài công khai đã đăng, có ít nhất một video phát được, mới nhất trước (trang tác giả, cursor cũ). */
  listPlayablePosts(query: FeedListQuery): Promise<FeedPostRow[]>;
  /** Cùng điều kiện lọc với listPlayablePosts nhưng chỉ bài trong HOT_WINDOW_DAYS ngày gần đây, xếp theo điểm hot giảm dần; bằng điểm thì ngẫu nhiên theo seed. */
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
