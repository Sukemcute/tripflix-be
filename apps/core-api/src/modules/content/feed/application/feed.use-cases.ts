import { Inject, Injectable } from '@nestjs/common';
import { MediaFacade, type PlaybackInfo } from '../../media/media.facade.js';
import { encodeFeedCursor, type FeedCursor } from '../domain/feed-cursor.js';
import { FEED_STORE, type FeedPostRow, type FeedStore } from './ports.js';

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

/** Bản đầu của F1: bài mới nhất. Xếp hạng, snapshot, các tab khác thuộc các phần sau (docs/09 mục 3 đến 5). */
@Injectable()
export class FeedUseCases {
  constructor(
    @Inject(FEED_STORE) private readonly store: FeedStore,
    @Inject(MediaFacade) private readonly media: MediaFacade,
  ) {}

  async getPage(query: { limit: number; after: FeedCursor | null; viewerId: string | null }): Promise<FeedPage> {
    const rows = await this.store.listPlayablePosts({ limit: query.limit + 1, after: query.after });
    const pageRows = rows.slice(0, query.limit);
    const postIds = pageRows.map((row) => row.id);
    const [playback, liked, saved] = await Promise.all([
      this.media.getPlayback(pageRows.flatMap((row) => row.mediaIds)),
      query.viewerId ? this.store.findLikedPostIds(query.viewerId, postIds) : [],
      query.viewerId ? this.store.findSavedPostIds(query.viewerId, postIds) : [],
    ]);
    const likedIds = new Set(liked);
    const savedIds = new Set(saved);

    const items = pageRows.flatMap((row) => {
      // Một bài có thể có nhiều media; lấy video đầu tiên phát được.
      const mediaId = row.mediaIds.find((id) => playback[id]);
      const video = mediaId ? playback[mediaId] : undefined;
      if (!video) return [];
      const viewerState = query.viewerId ? { liked: likedIds.has(row.id), saved: savedIds.has(row.id) } : null;
      return [buildCard(row, video, viewerState)];
    });

    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeFeedCursor({ at: last.cursorAt, id: last.id }) : null,
    };
  }
}

function buildCard(row: FeedPostRow, video: PlaybackInfo, viewerState: FeedCard['viewerState']): FeedCard {
  return {
    postId: row.id,
    // Tên, ảnh đại diện thuộc module access, hiện chưa có hàm cho module khác đọc.
    author: { id: row.authorId, name: null, avatarUrl: null, isKol: false },
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
