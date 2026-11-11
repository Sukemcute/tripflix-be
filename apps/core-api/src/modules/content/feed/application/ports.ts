import type { FeedCursor } from '../domain/feed-cursor.js';

export const FEED_STORE = Symbol('FEED_STORE');
export const FEED_PAGE_CACHE = Symbol('FEED_PAGE_CACHE');

export interface FeedPostRow {
  id: string;
  authorId: string;
  title: string;
  body: string;
  hashtags: string[];
  mediaIds: string[];
  reactionTotal: number;
  commentCount: number;
  bookmarkCount: number;
  shareCount: number;
  cursorAt: string;
}

export interface FeedStore {
  /** Bài công khai đã đăng, có ít nhất một video phát được, mới nhất trước. */
  listPlayablePosts(query: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]>;
  /** Cùng điều kiện lọc với listPlayablePosts nhưng chỉ bài trong HOT_WINDOW_DAYS ngày gần đây, xếp theo điểm hot giảm dần rồi mới nhất trước. */
  listHotPosts(query: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]>;
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
