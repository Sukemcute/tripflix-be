import { Inject, Injectable, Optional } from '@nestjs/common';
import { AccessFacade, type PublicAuthor } from '../../../access/index.js';
import type { TripAttachmentData } from '../../db/schema/posts.js';
import { MediaFacade, type PlaybackInfo } from '../../media/media.facade.js';
import { decodeFeedCursor, encodeFeedCursor, type FeedCursor } from '../domain/feed-cursor.js';
import { pickFeedSeed } from '../domain/feed-rank.js';
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
  /** Tích "Đã đi": lộ trình lấy từ chuyến đã đi xong của chính người đăng (TF105). */
  isVerified: boolean;
  counts: { likes: number; comments: number; saves: number; shares: number };
  viewerState: { liked: boolean; saved: boolean } | null;
  reason: { code: string; text: string } | null;
}

export interface FeedPage {
  items: FeedCard[];
  nextCursor: string | null;
}

/** Một bài trong danh sách Hot cho module khác, kèm cursor để trang sau bắt đầu ngay sau bài này. */
export interface HotFeedEntry {
  postId: string;
  /** Điểm Hot trong [0, 1] (trend_scores, TF111), cùng thang với getHotScores. */
  score: number;
  cursor: string;
}

export interface HotFeedIdPage {
  items: HotFeedEntry[];
  /** Cursor sau bài cuối đã đọc (kể cả bài bị bỏ vì video chưa phát được); null nghĩa là hết bài. */
  nextCursor: string | null;
}

/** Số bài tối đa mỗi lần getHotIds, để module khác không kéo cả danh sách trong một lần. */
export const HOT_IDS_MAX_LIMIT = 50;

export class InvalidHotCursorError extends Error {}

/** Trang đầu giống nhau với mọi người nên giữ ngắn trong Redis; bài mới hay số đếm trễ tối đa chừng này giây. */
// 16 seed × 10 giây gần như lần nào cũng trượt cache khi ít người xem; 60 giây vẫn đủ mới cho trang đầu.
export const FEED_FIRST_PAGE_TTL_SECONDS = 60;

/**
 * F1: for_you và hot cùng xếp theo điểm job chấm sẵn trong trend_scores (TF111), bằng điểm thì ngẫu nhiên
 * (domain/feed-rank.ts). TF121: for_you từng chấm điểm mọi bài ở mỗi lần đọc, chỉ chịu khoảng 10 req/s (TF120);
 * người đăng nhập đã đọc Dành cho bạn từ discovery, nên feed for_you chỉ còn cho khách, app bản cũ và màn trợ lý.
 * Trang tác giả và Reels đã lưu vẫn mới nhất trước.
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
      : query.authorId
        ? await this.loadSharedPage(tab, query.limit, query.after, null, query.authorId)
        : await this.loadHotOrderPage(query.limit, query.after);
    if (!query.viewerId) return shared;
    return { items: await this.withViewerState(shared.items, query.viewerId), nextCursor: shared.nextCursor };
  }

  /**
   * Thẻ Reels của đúng các bài cần mở (từ kết quả tìm kiếm, link chia sẻ), theo thứ tự `postIds`.
   * Bài không xem được trên feed (ẩn, riêng tư, đã xoá, không phải Reels, video chưa xử lý xong) thì bỏ qua.
   */
  async getByIds(postIds: string[], viewerId: string | null): Promise<FeedPage> {
    const ids = [...new Set(postIds)];
    const cards = await this.buildCards(await this.store.findPlayablePostsByIds(ids));
    const byId = new Map(cards.map((card) => [card.postId, card]));
    const items = ids.flatMap((id) => byId.get(id) ?? []);
    return { items: viewerId ? await this.withViewerState(items, viewerId) : items, nextCursor: null };
  }

  /**
   * Thời lượng video theo bài, chỉ bài phát được (cùng điều kiện với getByIds). Cho sự kiện xem: không dựng thẻ
   * (tên tác giả, ảnh bìa, playback) chỉ để lấy một con số.
   */
  async getDurations(postIds: string[]): Promise<Map<string, PlaybackInfo['durationSec']>> {
    const rows = await this.store.findPlayablePostsByIds([...new Set(postIds)]);
    const playback = await this.media.getPlayback(rows.flatMap((row) => row.mediaIds));
    return new Map(
      rows.flatMap((row) => {
        const mediaId = row.mediaIds.find((id) => playback[id]);
        return mediaId ? [[row.id, playback[mediaId]!.durationSec] as const] : [];
      }),
    );
  }

  /**
   * Id bài của tab Đang hot theo đúng thứ tự tab đó (TF110), cho discovery trộn vào Reels.
   * Không dựng thẻ: chỉ hỏi media để bỏ bài chưa có video phát được, bên gọi dựng thẻ bằng getByIds.
   * Mỗi bài kèm cursor riêng, vì bên gọi có thể chỉ dùng vài bài đầu của trang.
   */
  async getHotIds(query: { limit: number; cursor: string | null }): Promise<HotFeedIdPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > HOT_IDS_MAX_LIMIT) {
      throw new RangeError(`limit phải từ 1 đến ${HOT_IDS_MAX_LIMIT}`);
    }
    const after = query.cursor === null ? null : decodeFeedCursor(query.cursor);
    // Cursor của tab khác (không có score, hoặc có rank của Dành cho bạn) sẽ cắt danh sách sai vị trí.
    if (query.cursor !== null && (!after || after.score === undefined || after.rank !== undefined)) {
      throw new InvalidHotCursorError('Cursor không thuộc danh sách Hot');
    }
    const seed = after ? (after.seed ?? 0) : pickFeedSeed(this.random);
    const rows = await this.store.listHotPosts({ limit: query.limit + 1, after, seed });
    const pageRows = rows.slice(0, query.limit);
    const playback = pageRows.length > 0 ? await this.media.getPlayback(pageRows.flatMap((row) => row.mediaIds)) : {};
    const cursorAfter = (row: FeedPostRow) =>
      encodeFeedCursor({ at: row.cursorAt, id: row.id, score: row.hotScore ?? 0, seed });

    const last = pageRows.at(-1);
    return {
      items: pageRows
        .filter((row) => row.mediaIds.some((id) => playback[id]))
        .map((row) => ({ postId: row.id, score: row.hotScore ?? 0, cursor: cursorAfter(row) })),
      nextCursor: rows.length > query.limit && last ? cursorAfter(last) : null,
    };
  }

  /** Thích, lưu là của từng người nên luôn đọc mới, kể cả khi phần chung lấy từ cache. */
  private async withViewerState(items: FeedCard[], viewerId: string): Promise<FeedCard[]> {
    const postIds = items.map((item) => item.postId);
    const [liked, saved] = await Promise.all([
      this.store.findLikedPostIds(viewerId, postIds),
      this.store.findSavedPostIds(viewerId, postIds),
    ]);
    const likedIds = new Set(liked);
    const savedIds = new Set(saved);
    return items.map((item) => ({
      ...item,
      viewerState: { liked: likedIds.has(item.postId), saved: savedIds.has(item.postId) },
    }));
  }

  /** Thứ tự Hot của cả hai tab. Cursor for_you trước TF121 (chưa có điểm Hot) không nối tiếp được: trả lại trang đầu, giữ seed. */
  private loadHotOrderPage(limit: number, after: FeedCursor | null): Promise<SharedFeedPage<FeedCard>> {
    if (!after) return this.loadFirstPage('hot', limit);
    if (after.score === undefined) return this.loadSharedPage('hot', limit, null, null, undefined, after.seed ?? 0);
    return this.loadSharedPage('hot', limit, after);
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
    // Cursor cũ chưa có seed thì lấy seed 0, để các trang sau của nó vẫn cùng một thứ tự.
    const seed = after ? (after.seed ?? 0) : (firstPageSeed ?? pickFeedSeed(this.random));
    const listQuery = { limit: limit + 1, after, ...(authorId ? { authorId } : {}) };
    // Trang tác giả tab for_you và Reels đã lưu giữ mới nhất trước.
    const rows = await (savedByUserId
      ? this.store.listSavedPlayablePosts({ ...listQuery, userId: savedByUserId })
      : isHot
        ? this.store.listHotPosts({ ...listQuery, seed })
        : this.store.listPlayablePosts(listQuery));
    const pageRows = rows.slice(0, limit);
    const items = await this.buildCards(pageRows);

    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeFeedCursor({
              at: last.cursorAt,
              id: last.id,
              ...(isHot ? { score: last.hotScore ?? 0, seed } : {}),
            })
          : null,
    };
  }

  private async buildCards(rows: FeedPostRow[]): Promise<FeedCard[]> {
    const posterIds = rows.flatMap((row) => (row.tripAttachment?.posterMediaId ? [row.tripAttachment.posterMediaId] : []));
    const [playback, authors, posters] = await Promise.all([
      this.media.getPlayback(rows.flatMap((row) => row.mediaIds)),
      this.access
        ? this.access.getPublicAuthors(rows.map((r) => r.authorId)).catch(() => new Map<string, PublicAuthor>())
        : new Map<string, PublicAuthor>(),
      posterIds.length > 0 ? this.media.getImages(posterIds) : Promise.resolve({} as Awaited<ReturnType<MediaFacade['getImages']>>),
    ]);
    return rows.flatMap((row) => {
      // Một bài có thể có nhiều media; lấy video đầu tiên phát được.
      const mediaId = row.mediaIds.find((id) => playback[id]);
      const video = mediaId ? playback[mediaId] : undefined;
      if (!video) return [];
      const posterId = row.tripAttachment?.posterMediaId;
      return [buildCard(row, video, null, authors.get(row.authorId) ?? null, posterId ? posters[posterId]?.url : undefined)];
    });
  }
}

function maskTripAttachment(attachment: TripAttachmentData | null, posterUrl?: string): TripAttachmentData | null {
  if (!attachment) return null;
  const { bookingId: _bookingId, posterUrl: _storedPosterUrl, ...rest } = attachment;
  return {
    ...rest,
    ...(posterUrl ? { posterUrl } : {}),
    priceDisclaimer: attachment.priceDisclaimer ?? 'Giá chỉ mang tính chất tham khảo',
  };
}

function buildCard(
  row: FeedPostRow,
  video: PlaybackInfo,
  viewerState: FeedCard['viewerState'],
  author: PublicAuthor | null = null,
  posterUrl?: string,
): FeedCard {
  return {
    postId: row.id,
    author: { id: row.authorId, name: author?.displayName ?? null, avatarUrl: author?.avatarUrl ?? null, isKol: false },
    video,
    title: row.title,
    caption: row.body,
    // Bảng posts chưa có vùng và sản phẩm gắn kèm.
    region: null,
    tags: row.hashtags,
    linkedProductIds: [],
    tripAttachment: maskTripAttachment(row.tripAttachment, posterUrl),
    isVerified: row.isVerified ?? false,
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
