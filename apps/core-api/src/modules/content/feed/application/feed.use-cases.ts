import { Inject, Injectable, Optional } from '@nestjs/common';
import { AccessFacade } from '../../../access/index.js';
import type { TripAttachmentData } from '../../db/schema/posts.js';
import { MediaFacade, type PlaybackInfo } from '../../media/media.facade.js';
import { encodeFeedCursor, type FeedCursor } from '../domain/feed-cursor.js';
import { pickFeedSeed } from '../domain/feed-rank.js';
import { calculateHotScore } from '../domain/hot-score.js';
import {
  FEED_PAGE_CACHE,
  FEED_RANDOM,
  FEED_STORE,
  type FeedPageCache,
  type FeedPostRow,
  type FeedStore,
  type SharedFeedPage,
} from './ports.js';

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
  tripAttachment: TripAttachmentData | null;
  counts: { likes: number; comments: number; saves: number; shares: number };
  viewerState: { liked: boolean; saved: boolean } | null;
  reason: { code: string; text: string } | null;
}

export interface FeedPage {
  items: FeedCard[];
  nextCursor: string | null;
}

/** Trang đầu giống nhau với mọi người nên giữ ngắn trong Redis; bài mới hay số đếm trễ tối đa chừng này giây. */
export const FEED_FIRST_PAGE_TTL_SECONDS = 10;

/**
 * F1: for_you xếp theo điểm tương tác có bán rã, bài chưa có tương tác chen vào ngẫu nhiên; hot theo bộ đếm tương tác,
 * bằng điểm thì ngẫu nhiên (domain/feed-rank.ts). Trang tác giả và Reels đã lưu vẫn mới nhất trước.
 * Trending, snapshot, tab following thuộc các phần sau (docs/09 mục 3 đến 5).
 */
@Injectable()
export class FeedUseCases {
  /** Trang đầu đang được đọc từ database: request tới cùng lúc chờ chung một lần đọc thay vì mỗi request một lần. */
  private readonly loading = new Map<string, Promise<SharedFeedPage<FeedCard>>>();

  constructor(
    @Inject(FEED_STORE) private readonly store: FeedStore,
    @Inject(MediaFacade) private readonly media: MediaFacade,
    @Optional() @Inject(AccessFacade) private readonly access?: AccessFacade,
    @Optional() @Inject(FEED_PAGE_CACHE) private readonly cache?: FeedPageCache,
    /** Nguồn ngẫu nhiên chọn seed ở trang đầu; test truyền hàm cố định. */
    @Optional() @Inject(FEED_RANDOM) private readonly random: () => number = Math.random,
  ) {}

  async getPage(query: {
    tab?: FeedTab;
    limit: number;
    after: FeedCursor | null;
    viewerId: string | null;
    authorId?: string;
    /** Chỉ Reels người xem đã lưu, mới nhất trước; bỏ qua tab và không dùng cache vì là dữ liệu riêng. */
    isSavedOnly?: boolean;
  }): Promise<FeedPage> {
    if (query.isSavedOnly && !query.viewerId) throw new Error('Feed đã lưu cần người xem đăng nhập');
    const tab = query.tab === 'hot' ? 'hot' : 'for_you';
    const shared = query.isSavedOnly
      ? await this.loadSharedPage('for_you', query.limit, query.after, query.viewerId, query.authorId)
      : query.after || query.authorId
        ? await this.loadSharedPage(tab, query.limit, query.after, null, query.authorId)
        : await this.loadFirstPage(tab, query.limit);
    if (!query.viewerId) return shared;

    // Thích, lưu là của từng người nên luôn đọc mới, kể cả khi phần chung lấy từ cache.
    const postIds = shared.items.map((item) => item.postId);
    const [liked, saved] = await Promise.all([
      this.store.findLikedPostIds(query.viewerId, postIds),
      this.store.findSavedPostIds(query.viewerId, postIds),
    ]);
    const likedIds = new Set(liked);
    const savedIds = new Set(saved);
    return {
      items: shared.items.map((item) => ({
        ...item,
        viewerState: { liked: likedIds.has(item.postId), saved: savedIds.has(item.postId) },
      })),
      nextCursor: shared.nextCursor,
    };
  }

  private async loadFirstPage(tab: FeedTab, limit: number): Promise<SharedFeedPage<FeedCard>> {
    // Mỗi lần mở hay tải lại chọn seed mới, nên thứ tự đổi; mỗi seed một khoá để cache vẫn trúng khi đông người.
    const seed = pickFeedSeed(this.random);
    // v3: thứ tự theo seed, cursor có seed (v2: thẻ có tripAttachment, chỉ bài video).
    const key = `feed:first-page:v3:${tab}:${seed}:${limit}`;
    const cached = await this.readCache(key);
    if (cached) return cached;
    const inFlight = this.loading.get(key);
    if (inFlight) return inFlight;
    const load = this.loadSharedPage(tab, limit, null, null, undefined, seed)
      .then(async (page) => {
        await this.cache?.set(key, page, FEED_FIRST_PAGE_TTL_SECONDS).catch(() => undefined);
        return page;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, load);
    return load;
  }

  /** Redis lỗi hoặc chưa cấu hình thì coi như chưa có cache: feed vẫn chạy, chỉ chậm hơn. */
  private async readCache(key: string): Promise<SharedFeedPage<FeedCard> | null> {
    if (!this.cache) return null;
    try {
      return await this.cache.get<FeedCard>(key);
    } catch {
      return null;
    }
  }

  private async loadSharedPage(
    tab: FeedTab,
    limit: number,
    after: FeedCursor | null,
    savedByUserId: string | null = null,
    authorId?: string,
    firstPageSeed?: number,
  ): Promise<SharedFeedPage<FeedCard>> {
    const isHot = tab === 'hot' && !savedByUserId;
    // Trang tác giả và Reels đã lưu giữ mới nhất trước; cursor for_you cũ (app bản trước, chưa có rank) cũng vậy.
    const isRankedForYou = tab === 'for_you' && !savedByUserId && !authorId && (!after || after.rank !== undefined);
    // Cursor cũ chưa có seed thì lấy seed 0, để các trang sau của nó vẫn cùng một thứ tự.
    const seed = after ? (after.seed ?? 0) : (firstPageSeed ?? pickFeedSeed(this.random));
    const asOf = after?.asOf ?? new Date().toISOString();
    const listQuery = { limit: limit + 1, after, ...(authorId ? { authorId } : {}) };
    const rows = await (savedByUserId
      ? this.store.listSavedPlayablePosts({ ...listQuery, userId: savedByUserId })
      : isHot
        ? this.store.listHotPosts({ ...listQuery, seed })
        : isRankedForYou
          ? this.store.listForYouPosts({ ...listQuery, seed, asOf })
          : this.store.listPlayablePosts(listQuery));
    const pageRows = rows.slice(0, limit);
    const [playback, authorNames] = await Promise.all([
      this.media.getPlayback(pageRows.flatMap((row) => row.mediaIds)),
      this.access
        ? this.access.getDisplayNames(pageRows.map((r) => r.authorId)).catch(() => new Map<string, string>())
        : new Map<string, string>(),
    ]);

    const items = pageRows.flatMap((row) => {
      // Một bài có thể có nhiều media; lấy video đầu tiên phát được.
      const mediaId = row.mediaIds.find((id) => playback[id]);
      const video = mediaId ? playback[mediaId] : undefined;
      if (!video) return [];
      return [buildCard(row, video, null, authorNames.get(row.authorId) ?? null)];
    });

    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeFeedCursor({
              at: last.cursorAt,
              id: last.id,
              ...(isHot ? { score: calculateHotScore(last), seed } : {}),
              ...(isRankedForYou && last.rank !== undefined ? { rank: last.rank, seed, asOf } : {}),
            })
          : null,
    };
  }
}

function maskTripAttachment(attachment: TripAttachmentData | null): TripAttachmentData | null {
  if (!attachment) return null;
  const { bookingId: _bookingId, ...rest } = attachment;
  return {
    ...rest,
    priceDisclaimer: attachment.priceDisclaimer ?? 'Giá chỉ mang tính chất tham khảo',
  };
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
    tripAttachment: maskTripAttachment(row.tripAttachment),
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
