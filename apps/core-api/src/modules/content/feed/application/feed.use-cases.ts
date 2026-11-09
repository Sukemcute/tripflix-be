import { Inject, Injectable, Optional } from '@nestjs/common';
import { AccessFacade } from '../../../access/index.js';
import { MediaFacade, type PlaybackInfo } from '../../media/media.facade.js';
import { encodeFeedCursor, type FeedCursor } from '../domain/feed-cursor.js';
import { calculateHotScore } from '../domain/hot-score.js';
import { FEED_STORE, type FeedPostRow, type FeedStore } from './ports.js';

export const FEED_TABS = ['for_you', 'hot'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

export interface FeedCard {
  postId: string;
  author: { id: string; name: string | null; avatarUrl: string | null; isKol: boolean };
  video: PlaybackInfo;
  title: string;
  caption: string;
  region: string | null;
  tags: string[];
  linkedProductIds: string[];
  counts: { likes: number; comments: number; saves: number; shares: number };
  viewerState: { liked: boolean; saved: boolean } | null;
  reason: { code: string; text: string } | null;
}

export interface FeedPage {
  items: FeedCard[];
  nextCursor: string | null;
}

/** Bản đầu của F1: for_you lấy bài mới nhất, hot lấy theo bộ đếm tương tác. Trending, snapshot, tab following thuộc các phần sau (docs/09 mục 3 đến 5). */
@Injectable()
export class FeedUseCases {
  constructor(
    @Inject(FEED_STORE) private readonly store: FeedStore,
    @Inject(MediaFacade) private readonly media: MediaFacade,
    @Optional() @Inject(AccessFacade) private readonly access?: AccessFacade,
  ) {}

  async getPage(query: {
    tab?: FeedTab;
    limit: number;
    after: FeedCursor | null;
    viewerId: string | null;
  }): Promise<FeedPage> {
    const isHot = query.tab === 'hot';
    const listQuery = { limit: query.limit + 1, after: query.after };
    const rows = await (isHot ? this.store.listHotPosts(listQuery) : this.store.listPlayablePosts(listQuery));
    const pageRows = rows.slice(0, query.limit);
    const postIds = pageRows.map((row) => row.id);
    const [playback, liked, saved, authorNames] = await Promise.all([
      this.media.getPlayback(pageRows.flatMap((row) => row.mediaIds)),
      query.viewerId ? this.store.findLikedPostIds(query.viewerId, postIds) : [],
      query.viewerId ? this.store.findSavedPostIds(query.viewerId, postIds) : [],
      this.access
        ? this.access.getDisplayNames(pageRows.map((r) => r.authorId)).catch(() => new Map<string, string>())
        : new Map<string, string>(),
    ]);
    const likedIds = new Set(liked);
    const savedIds = new Set(saved);

    const items = pageRows.flatMap((row) => {
      // Một bài có thể có nhiều media; lấy video đầu tiên phát được.
      const mediaId = row.mediaIds.find((id) => playback[id]);
      const video = mediaId ? playback[mediaId] : undefined;
      if (!video) return [];
      const viewerState = query.viewerId ? { liked: likedIds.has(row.id), saved: savedIds.has(row.id) } : null;
      return [buildCard(row, video, viewerState, authorNames.get(row.authorId) ?? null)];
    });

    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeFeedCursor({
              at: last.cursorAt,
              id: last.id,
              ...(isHot ? { score: calculateHotScore(last) } : {}),
            })
          : null,
    };
  }
}

function buildCard(
  row: FeedPostRow,
  video: PlaybackInfo,
  viewerState: FeedCard['viewerState'],
  authorName: string | null = null,
): FeedCard {
  return {
    postId: row.id,
    author: { id: row.authorId, name: authorName, avatarUrl: null, isKol: false },
    video,
    title: row.title,
    caption: row.body,
    // Bảng posts chưa có vùng và sản phẩm gắn kèm.
    region: null,
    tags: row.hashtags,
    linkedProductIds: [],
    counts: {
      likes: row.reactionTotal,
      comments: row.commentCount,
      saves: row.bookmarkCount,
      shares: row.shareCount,
    },
    viewerState,
    reason: null,
  };
}
