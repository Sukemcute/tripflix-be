import type { FeedCursor } from '../domain/feed-cursor.js';

export const FEED_STORE = Symbol('FEED_STORE');

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
  /** Cùng điều kiện lọc với listPlayablePosts, xếp theo điểm hot giảm dần rồi mới nhất trước. */
  listHotPosts(query: { limit: number; after: FeedCursor | null }): Promise<FeedPostRow[]>;
  findLikedPostIds(userId: string, postIds: string[]): Promise<string[]>;
  findSavedPostIds(userId: string, postIds: string[]): Promise<string[]>;
}
