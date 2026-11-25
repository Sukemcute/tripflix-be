import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MIX_REELS_DEFAULT_EVERY, mixReels } from '../../../content/index.js';
import { exploreSlots, interleave, mergeCandidates, pickExplore, tasteOf } from '../domain/candidates.js';
import type { CandidateSource, RankedItem, ViewerRaw } from '../domain/contracts.js';
import { applyFeedPolicy, OWN_POST_REASON } from '../domain/feed-policy.js';
import { resolveAlgo, type AlgoRow, type ResolvedAlgo } from '../domain/registry.js';
import { hotelIdOfProduct } from '../domain/place-of-post.js';
import { TRENDING } from '../domain/rankers/rankers.js';
import { placeStyleProfiles } from '../domain/place-topics.js';
import { blendSessionTaste } from '../domain/session-taste.js';
import {
  RECENT_POSTS_STORE,
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  SERVED_STORE,
  TASTE_RETRIEVAL,
  type RecommendCardPost,
  type RecommendReelCard,
  type RecentPostsStore,
  type RecommendCatalog,
  type RecommendStore,
  type ServedStore,
  type TasteRetrieval,
} from './ports.js';

export type RecommendMode = 'for_you' | 'trending' | 'has_plan' | 'recent' | 'mixed';

const RECENT_REASON = { code: 'recent', text: 'Mới đăng' };

const ALGO_CACHE_MS = 60_000;
const PLACE_PROFILE_CACHE_MS = 10 * 60_000;
const HOT_LIMIT = 150;
/** Mỗi nguồn gu (nơi, tag) lấy chừng này bài. */
const TASTE_PER_SOURCE = 150;
const FRESH_LIMIT = 50;
const FRESH_HOURS = 48;
const EXPLORE_POOL_LIMIT = 500;
const EXPLORE_DAYS = 30;
/** Số bài khám phá giữ trước cho cả phiên (đủ cho ~50 trang). */
const EXPLORE_RESERVE = 50;
const FULL_READ_EXPLORE_SKIP = 100;
/** Số trang rỗng (bị lọc hết sau hydrate) server tự bỏ qua trong một request. */
const MAX_EMPTY_PAGE_SKIPS = 3;
/**
 * Kết quả xếp hạng của một phiên (đã chốt theo sessionAt nên trang nào cũng như nhau): giữ lại để trang sau chỉ cắt
 * offset, không đọc lại tới 5.000 ứng viên và xếp lại.
 */
const RANKED_SESSION_CACHE_MS = 5 * 60_000;
const RANKED_SESSION_CACHE_MAX = 500;
/** Bộ ba dự phòng khi dòng trending trong DB cũng hỏng: endpoint không bao giờ chết vì cấu hình. */
const FALLBACK: AlgoRow = { name: 'trending', postBuilder: 'hot@v1', userBuilder: 'none@v0', ranker: 'popular_v0' };

export interface PostRecommendationQuery {
  mode: RecommendMode;
  postType: string | null;
  limit: number;
  cursor: string | null;
  userId: string | null;
  now?: Date;
  /** Người xem tự tải lại (trang đầu): đẩy xuống cả bài vừa gợi ý trong phiên, không chỉ bài của phiên trước. */
  fresh?: boolean;
}

export interface PostRecommendationItem {
  post: RecommendCardPost;
  source: CandidateSource;
  reason: { code: string; text: string };
}

export interface PostRecommendationPage {
  items: PostRecommendationItem[];
  algo: string;
  nextCursor: string | null;
}

export interface ReelRecommendationItem {
  card: RecommendReelCard;
  source: CandidateSource;
  reason: { code: string; text: string };
}

export interface ReelRecommendationPage {
  items: ReelRecommendationItem[];
  algo: string;
  nextCursor: string | null;
}

export class ReelsFeedNotWiredError extends Error {}

/** Bài gợi ý trước mốc này tính là "phiên trước" và bị phạt điểm; bài gợi ý trong phiên giữ chỗ. */
const SESSION_MS = 30 * 60_000;

/** Cursor do server cấp: giữ thuật toán, mode, offset và mốc "phiên trước" của trang đầu. */
interface Cursor {
  algo: string;
  mode?: RecommendMode;
  page: number;
  offset: number;
  seenBefore: number;
  /** Mốc đọc bài đã gợi ý khi trang đầu là `fresh`; không có thì bằng `seenBefore`. Giữ trong cursor để trang sau đẩy xuống cùng một tập. */
  seenUntil?: number;
  /** Reels Hot của feed (chip Thịnh hành, ô hot của mixed): cursor của FeedFacade.listTopHot; null là từ đầu. */
  hot?: string | null;
  /** mixed: vị trí đã dùng của danh sách Dành cho bạn (algo, page, offset); null là đã hết. */
  fy?: { algo: string; page: number; offset: number } | null;
  /** mixed: danh sách Hot đã hết. */
  hotDone?: boolean;
}

/** algo của chip Thịnh hành Reels lấy thẳng thứ tự Hot của feed (TF111), để cursor không lẫn với trending của discovery. */
const FEED_HOT_ALGO = 'feed_hot';
const MIXED_ALGO = 'mixed';

/** Bài tự đăng trong khoảng này trước trang đầu được đưa lên đầu feed của chính người đăng. */
const OWN_RECENT_MS = 60 * 60_000;

export class InvalidRecommendCursorError extends Error {}

/**
 * Mốc đọc bài đã gợi ý. Mặc định là `seenBefore` (chỉ bài của phiên trước, để trang trong phiên không xô lệch).
 * Trang đầu `fresh` lấy `now`, để tải lại không ra y hệt trang cũ; trang sau đọc lại từ cursor.
 */
function resolveSeenUntil(cursor: Cursor | null, seenBefore: number, fresh: boolean | undefined, now: Date): number {
  if (cursor) return cursor.seenUntil ?? seenBefore;
  return fresh ? now.getTime() : seenBefore;
}

/** Chỉ ghi `seenUntil` vào cursor khi khác `seenBefore`, cursor cũ giữ nguyên dạng. */
const seenUntilField = (seenUntil: number, seenBefore: number) => (seenUntil === seenBefore ? {} : { seenUntil });

/** Bài Hot của feed trong trang gợi ý: không qua ranker của discovery nên không có điểm, tác giả. */
const hotItem = (postId: string): RankedItem => ({ postId, authorId: '', score: 0, source: 'hot', breakdown: {}, reason: TRENDING });

const VALID_MODES = new Set<RecommendMode>(['for_you', 'trending', 'has_plan', 'recent', 'mixed']);

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Partial<Cursor>;
    if (
      typeof c.algo === 'string' &&
      (c.mode === undefined || VALID_MODES.has(c.mode)) &&
      Number.isInteger(c.page) &&
      Number.isInteger(c.offset) &&
      Number.isInteger(c.seenBefore) &&
      (c.seenUntil === undefined || Number.isInteger(c.seenUntil)) &&
      c.page! >= 0 &&
      c.offset! >= 0 &&
      (c.hot === undefined || c.hot === null || typeof c.hot === 'string') &&
      (c.fy === undefined ||
        c.fy === null ||
        (typeof c.fy === 'object' && typeof c.fy.algo === 'string' && Number.isInteger(c.fy.page) && Number.isInteger(c.fy.offset)))
    ) {
      return c as Cursor;
    }
  } catch {
    // rơi xuống lỗi bên dưới
  }
  throw new InvalidRecommendCursorError('cursor không hợp lệ');
}

/**
 * Gợi ý bài viết (đề xuất recommend-offline mục 6): ứng viên → ranker → chính sách theo người xem (mục 6.3) → trộn explore.
 * Không ghi Postgres. Không bỏ bài nào vì lịch sử người dùng, chỉ phạt/cộng điểm.
 */
@Injectable()
export class PostRecommendationUseCases {
  private readonly logger = new Logger(PostRecommendationUseCases.name);
  private algoCache: { at: number; rows: Map<string, AlgoRow> } | null = null;
  private placeProfileCache: { at: number; profiles: Map<string, Record<string, number>> } | null = null;
  private readonly rankedSessions = new Map<string, { at: number; rankedOnly: RankedItem[]; reserved: RankedItem[] }>();

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RECOMMEND_CATALOG) private readonly catalog: RecommendCatalog,
    @Inject(SERVED_STORE) private readonly served: ServedStore,
    @Inject(RECENT_POSTS_STORE) private readonly recentPosts: RecentPostsStore,
    @Optional() @Inject(TASTE_RETRIEVAL) private readonly tasteRetrieval?: TasteRetrieval,
  ) {}

  async recommend(q: PostRecommendationQuery): Promise<PostRecommendationPage> {
    const now = q.now ?? new Date();
    const { pageItems, algo, nextCursor, items } = await this.firstFilledPage(q.cursor, (cursor) => this.selectRankedPage({ ...q, cursor }, now), (ranked) => this.hydrate(ranked));
    if (q.userId) await this.recordSeen(q.userId, pageItems.map((i) => i.postId), now);
    for (const item of items) {
      this.logger.log({ mode: q.mode, algo: algo.name, source: item.source, postId: item.post.id }, 'recommend.served');
    }

    return { items, algo: algo.name, nextCursor };
  }

  /**
   * Gợi ý Reels (TF23): xếp hạng video bằng discovery rồi gọi FeedFacade.getByIds để lấy thẻ phát được,
   * giữ đúng thứ tự và bỏ bài chưa xử lý xong hoặc đã ẩn.
   */
  async recommendReels(q: Omit<PostRecommendationQuery, 'postType'>): Promise<ReelRecommendationPage> {
    if (!this.catalog.getReelCardsByIds) {
      throw new ReelsFeedNotWiredError('FeedFacade.getByIds chưa được nối vào RecommendCatalog');
    }
    const now = q.now ?? new Date();
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const mode = cursor?.mode ?? q.mode;
    const hydrate = (ranked: RankedItem[]) => this.hydrateReels(ranked, q.userId);
    const vq = { ...q, postType: 'video' };
    // Chip Thịnh hành lấy đúng thứ tự Hot của feed như tab "Đang hot" (TF111); cursor trending cũ của discovery đi tiếp đường cũ.
    const isFeedHot = mode === 'trending' && this.catalog.listTopHotReels !== undefined &&(!cursor || cursor.algo === FEED_HOT_ALGO);
    if (mode === 'mixed' && !this.catalog.listTopHotReels) {
      throw new ReelsFeedNotWiredError('FeedFacade.listTopHot chưa được nối vào RecommendCatalog');
    }
    const { algo, nextCursor, items } =
      mode === 'mixed'
        ? await this.firstFilledPage(q.cursor, (c) => this.selectMixedPage(vq, c ? decodeCursor(c) : null, now), hydrate)
        : isFeedHot
          ? await this.firstFilledPage(q.cursor, (c) => this.selectFeedHotPage(vq, c ? decodeCursor(c) : null), hydrate)
          : await this.firstFilledPage(q.cursor, (c) => this.selectRankedPage({ ...vq, cursor: c }, now), hydrate);
    if (q.userId && items.length) {
      await this.recordSeen(q.userId, items.map((i) => i.card.postId), now);
    }
    for (const item of items) {
      this.logger.log({ mode, algo: algo.name, source: item.source, postId: item.card.postId }, 'recommend.served');
    }

    return { items, algo: algo.name, nextCursor };
  }

  /** Một trang Hot của feed. Cursor feed sai (bị sửa tay) thì báo cursor không hợp lệ thay vì lỗi 500. */
  private async topHot(limit: number, cursor: string | null) {
    try {
      return await this.catalog.listTopHotReels!({ limit, cursor });
    } catch (err) {
      if (cursor !== null) throw new InvalidRecommendCursorError('cursor không hợp lệ');
      throw err;
    }
  }

  /** Chip Thịnh hành của Reels: giữ nguyên thứ tự Hot của feed, không xếp lại bằng discovery. */
  private async selectFeedHotPage(q: PostRecommendationQuery, c: Cursor | null) {
    const seenBefore = c?.seenBefore ?? Date.now() - SESSION_MS;
    const page = c?.page ?? 0;
    const hot = await this.topHot(q.limit, c?.hot ?? null);
    return {
      pageItems: hot.items.map((h) => hotItem(h.postId)),
      algo: { name: FEED_HOT_ALGO },
      nextCursor: hot.nextCursor ? encodeCursor({ algo: FEED_HOT_ALGO, mode: 'trending', page: page + 1, offset: 0, seenBefore, hot: hot.nextCursor }) : null,
    };
  }

  /**
   * Feed Reels trộn (TF110/TF111): cứ MIX_REELS_DEFAULT_EVERY ô thì ô cuối là Hot của feed, còn lại là Dành cho bạn, trộn bằng
   * mixReels của content. Cursor giữ vị trí đã dùng ở cả hai nguồn; một nguồn hết thì nguồn kia lấp cả trang.
   * ponytail: chỉ bỏ trùng trong cùng trang; bài Hot đã ra ở trang trước có thể gặp lại trong Dành cho bạn (FE đã bỏ trùng).
   */
  private async selectMixedPage(q: PostRecommendationQuery, c: Cursor | null, now: Date) {
    const seenBefore = c?.seenBefore ?? now.getTime() - SESSION_MS;
    const seenUntil = resolveSeenUntil(c, seenBefore, q.fresh, now);
    const page = c?.page ?? 0;
    const isFyDone = c !== null && c.fy === null;
    const isHotDone = c?.hotDone === true;
    const hotSlots = isFyDone ? q.limit : isHotDone ? 0 : Math.max(1, Math.floor(q.limit / MIX_REELS_DEFAULT_EVERY));
    const fySlots = isFyDone ? 0 : q.limit - (isHotDone ? 0 : hotSlots);
    const fyCursor = c?.fy ? encodeCursor({ ...c.fy, mode: 'for_you', seenBefore, ...seenUntilField(seenUntil, seenBefore) }) : null;

    const [fy, hot] = await Promise.all([
      fySlots > 0 ? this.selectRankedPage({ ...q, mode: 'for_you', limit: fySlots, cursor: fyCursor }, now) : null,
      hotSlots > 0 ? this.topHot(hotSlots, c?.hot ?? null) : null,
    ]);
    const fyItems = fy?.pageItems ?? [];
    const hotItems = hot?.items ?? [];
    const mixed = mixReels({ forYou: fyItems.map((i) => i.postId), hot: hotItems.map((h) => h.postId), limit: q.limit });
    const byId = new Map<string, RankedItem>([
      ...hotItems.map((h) => [h.postId, hotItem(h.postId)] as const),
      ...fyItems.map((i) => [i.postId, i] as const),
    ]);

    const fyNext = fy?.nextCursor ? decodeCursor(fy.nextCursor) : null;
    const nextFy = fy ? (fyNext ? { algo: fyNext.algo, page: fyNext.page, offset: fyNext.offset } : null) : (c?.fy ?? null);
    // Mỗi bài Hot có cursor riêng: đi tiếp ngay sau bài Hot cuối cùng đã dùng, bài lấy về mà chưa dùng thì trang sau gặp lại.
    const nextHot = mixed.usedHot > 0 ? hotItems[mixed.usedHot - 1]!.cursor : (c?.hot ?? null);
    const nextHotDone = isHotDone || (hot !== null && mixed.usedHot === hotItems.length && !hot.nextCursor);
    const hasMore = nextFy !== null || !nextHotDone;
    return {
      pageItems: mixed.ids.map((id) => byId.get(id)!),
      algo: { name: MIXED_ALGO },
      nextCursor:
        mixed.ids.length > 0 && hasMore
          ? encodeCursor({
              algo: MIXED_ALGO,
              mode: 'mixed',
              page: page + 1,
              offset: 0,
              seenBefore,
              ...seenUntilField(seenUntil, seenBefore),
              hot: nextHot,
              fy: nextFy,
              hotDone: nextHotDone,
            })
          : null,
    };
  }

  /**
   * Trang bị lọc hết sau hydrate (bài đã ẩn, video chưa xử lý xong) mà vẫn còn trang sau: lấy tiếp ở server thay vì trả
   * `items: []` kèm cursor, để client không bắn liền nhiều request rỗng. Giới hạn số lần để một dải dài bài lỗi không treo request.
   */
  private async firstFilledPage<P extends { pageItems: RankedItem[]; nextCursor: string | null }, T>(
    first: string | null,
    select: (cursor: string | null) => Promise<P>,
    hydrate: (ranked: RankedItem[]) => Promise<T[]>,
  ) {
    let cursor = first;
    for (let skipped = 0; ; skipped++) {
      const page = await select(cursor);
      const items = await hydrate(page.pageItems);
      if (items.length || !page.nextCursor || skipped >= MAX_EMPTY_PAGE_SKIPS) return { ...page, items };
      cursor = page.nextCursor;
    }
  }

  private async selectRankedPage(q: PostRecommendationQuery, now: Date) {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const mode = cursor?.mode ?? q.mode;
    if (mode === 'recent') {
      return this.selectRecentPage(q, cursor, now);
    }

    // Khách không có gu: for_you và has_plan của khách dùng trending.
    const requestedAlgo = mode === 'has_plan' ? 'for_you' : mode;
    const algoName = cursor?.algo ?? (q.userId ? requestedAlgo : 'trending');
    const algo = await this.loadAlgo(algoName);
    const page = cursor?.page ?? 0;
    const offset = cursor?.offset ?? 0;
    // Mốc "phiên trước" cố định từ trang đầu: cả phiên đẩy xuống cùng một tập bài nên trang không xô lệch.
    const seenBefore = cursor?.seenBefore ?? now.getTime() - SESSION_MS;
    const seenUntil = resolveSeenUntil(cursor, seenBefore, q.fresh, now);
    // Gu trong phiên chốt theo lúc tải trang đầu: tương tác giữa chừng có hiệu lực ở lần tải feed sau, trang không xô lệch.
    const sessionAt = seenBefore + SESSION_MS;
    const hasPlanOnly = mode === 'has_plan';
    const slots = exploreSlots(q.limit);
    const sessionKey = [q.userId ?? 'guest', algo.name, mode, q.postType ?? '', seenBefore, seenUntil].join('|');
    // Trang đầu (cả khi tải lại) luôn xếp mới; trang sau của cùng phiên đọc lại kết quả đó.
    const { rankedOnly, reserved } =
      (cursor ? this.readRankedSession(sessionKey) : null) ??
      this.writeRankedSession(sessionKey, await this.rankSession(q, { algo, hasPlanOnly, seenUntil, sessionAt, now }));
    const explore = reserved.slice(page * slots, (page + 1) * slots);
    // Kho explore thiếu (ít bài, mọi bài đã là ứng viên hot) thì lấp chỗ trống bằng bài đã xếp hạng.
    const rankedTake = rankedOnly.slice(offset, offset + q.limit - explore.length);
    const pageItems = interleave(rankedTake, explore, q.limit);

    // Phân trang bằng offset cho mọi người: gọi lại cùng cursor (tải lại sau khi thả tim) ra cùng trang.
    const nextOffset = offset + rankedTake.length;
    const hasMore = rankedOnly.length > nextOffset || reserved.length > (page + 1) * slots;
    return {
      pageItems,
      algo,
      nextCursor:
        pageItems.length > 0 && hasMore
          ? encodeCursor({ algo: algo.name, mode, page: page + 1, offset: nextOffset, seenBefore, ...seenUntilField(seenUntil, seenBefore) })
          : null,
    };
  }

  private readRankedSession(key: string) {
    const hit = this.rankedSessions.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at < RANKED_SESSION_CACHE_MS) return hit;
    this.rankedSessions.delete(key);
    return null;
  }

  private writeRankedSession(key: string, ranked: { rankedOnly: RankedItem[]; reserved: RankedItem[] }) {
    // Map giữ thứ tự chèn: đầy thì bỏ phiên cũ nhất.
    if (this.rankedSessions.size >= RANKED_SESSION_CACHE_MAX) this.rankedSessions.delete(this.rankedSessions.keys().next().value!);
    this.rankedSessions.set(key, { at: Date.now(), ...ranked });
    return ranked;
  }

  /** Xếp hạng cả phiên: ứng viên, ranker, chính sách theo người xem, tập bài khám phá giữ trước. */
  private async rankSession(
    q: PostRecommendationQuery,
    { algo, hasPlanOnly, seenUntil, sessionAt, now }: { algo: ResolvedAlgo; hasPlanOnly: boolean; seenUntil: number; sessionAt: number; now: Date },
  ): Promise<{ rankedOnly: RankedItem[]; reserved: RankedItem[] }> {
    // Mọi tín hiệu người xem chốt theo trang đầu (sessionAt): tương tác giữa phiên không làm trang sau xô lệch.
    const [interacted, seenIds, longTaste, recent, rawOwnRecent] = q.userId
      ? await Promise.all([
          this.store.listInteractedPostIds(q.userId, new Date(sessionAt)),
          this.listSeen(q.userId, new Date(seenUntil)),
          this.store.findUserFeatures(algo.userBuilder.key, q.userId),
          algo.userBuilder.key === 'tag_affinity@v0' ? this.listRecent(q.userId, new Date(sessionAt)) : [],
          this.store.listOwnRecentPostIds({
            userId: q.userId,
            since: new Date(sessionAt - OWN_RECENT_MS),
            until: new Date(sessionAt),
            postType: q.postType,
          }),
        ])
      : [[], [], null, [], []];

    let ownRecent = rawOwnRecent;
    if (hasPlanOnly && ownRecent.length) {
      const metas = new Map((await this.store.findPostMetas(ownRecent)).map((m) => [m.postId, m]));
      ownRecent = ownRecent.filter((id) => metas.get(id)?.hasPlan === true);
    }

    const userFeatures = await this.withSessionTaste(longTaste, recent, sessionAt);
    const seen = new Set(seenIds);
    // Nguồn ứng viên không loại bài theo lịch sử người dùng (mục 6.3); riêng explore bỏ bài đã gặp vì dành cho bài mới.
    const base = {
      postBuilder: algo.postBuilder.key,
      postType: q.postType,
      ...(hasPlanOnly ? { hasPlan: true } : {}),
      excludePostIds: [],
      now,
    };
    const taste = this.tasteRetrieval ? tasteOf(userFeatures) : null;
    // Nguồn gu chỉ BỔ SUNG ứng viên, không thay hot: gu dài hạn không gồm "đang tìm hiểu / sắp đi" (live-answers, trọng số
    // lớn nhất ở trip_v1). Giảm hot chỉ khi nguồn gu gồm cả tín hiệu đó và đã đo trên người dùng thật.
    const readsAll = Boolean(algo.ranker.candidateLimit);
    const hotLimit = algo.ranker.candidateLimit ?? HOT_LIMIT;
    const [hot, fresh, rawExplorePool, viewer, tasteIds] = await Promise.all([
      this.store.listHotCandidates({ ...base, limit: hotLimit }),
      this.store.listFreshCandidates({ ...base, limit: FRESH_LIMIT, hours: FRESH_HOURS }),
      this.store.listExplorePool({ ...base, excludePostIds: interacted, limit: EXPLORE_POOL_LIMIT, days: EXPLORE_DAYS }),
      algo.ranker.needsViewerRows && q.userId ? this.loadViewer(q.userId, new Date(sessionAt)) : null,
      taste ? this.findTasteIds(taste, q.postType, hasPlanOnly) : [],
    ]);
    const tasteCandidates = tasteIds.length ? await this.store.listCandidatesByIds({ ...base, limit: tasteIds.length }, tasteIds, 'taste') : [];
    const candidates = mergeCandidates(hot, fresh, tasteCandidates);
    const inCandidates = new Set(candidates.map((c) => c.postId));

    // Bài vừa đăng chưa qua job thì chưa là ứng viên: thêm thẳng, tầng chính sách đưa lên đầu.
    const ownExtra: RankedItem[] = ownRecent
      .filter((postId) => !inCandidates.has(postId))
      .map((postId) => ({ postId, authorId: q.userId!, score: 0, source: 'own', breakdown: {}, reason: OWN_POST_REASON }));
    // Xếp theo mốc trang đầu (sessionAt), không theo giờ gọi: điểm "vừa xảy ra" đổi theo phút, trang sau mà xếp lại thì offset lệch, bài lặp.
    const placeProfiles = algo.ranker.needsViewerRows ? await this.placeProfiles() : undefined;
    const ranked = applyFeedPolicy([...algo.ranker.rank({ candidates, userFeatures, now: new Date(sessionAt), viewer, placeProfiles }), ...ownExtra], {
      userId: q.userId,
      seen,
      interacted: new Set(interacted),
      ownRecent: new Set(ownRecent),
    });
    // Ranker đọc toàn bộ bài thì mọi bài đều là ứng viên: ô khám phá lấy bài xếp ngoài top, không lấy bài ngoài ứng viên.
    const topIds = new Set(ranked.slice(0, FULL_READ_EXPLORE_SKIP).map((r) => r.postId));
    const explorePool = rawExplorePool.filter(
      (c) => !seen.has(c.postId) && (readsAll ? !topIds.has(c.postId) : !inCandidates.has(c.postId)),
    );
    // Giữ trước một tập bài khám phá cố định cho cả phiên và bỏ chúng khỏi danh sách xếp hạng: bài khám phá không gặp lại ở trang sau.
    const reserved = pickExplore(explorePool, { userKey: q.userId ?? 'guest', day: new Date(sessionAt).toISOString().slice(0, 10) }, EXPLORE_RESERVE, 0);
    const reservedIds = new Set(reserved.map((r) => r.postId));
    const rankedOnly = ranked.filter((r) => !reservedIds.has(r.postId));
    return { rankedOnly, reserved };
  }

  /** Nguồn gu lỗi (Typesense chưa sẵn sàng) thì feed vẫn chạy với hot/fresh, chỉ ghi log. */
  private async findTasteIds(taste: { places: string[]; tags: string[] }, postType: string | null, hasPlan: boolean): Promise<string[]> {
    try {
      return await this.tasteRetrieval!.findPostIds({ ...taste, postType, hasPlan, limitPerSource: TASTE_PER_SOURCE });
    } catch (error) {
      this.logger.warn(`Nguồn gu (Typesense) lỗi, feed dùng hot/fresh: ${(error as Error).message}`);
      return [];
    }
  }

  /** Mode recent: mới nhất trước (cửa sổ 30 ngày), không qua ranker/explore/phạt lịch sử; bài tự đăng trong 1h lên đầu. */
  private async selectRecentPage(q: PostRecommendationQuery, cursor: Cursor | null, now: Date) {
    const page = cursor?.page ?? 0;
    const offset = cursor?.offset ?? 0;
    const seenBefore = cursor?.seenBefore ?? now.getTime() - SESSION_MS;
    const sessionAt = seenBefore + SESSION_MS;

    const [pool, ownRecent] = await Promise.all([
      this.store.listExplorePool({
        postBuilder: 'hot@v0',
        postType: q.postType,
        excludePostIds: [],
        limit: EXPLORE_POOL_LIMIT,
        days: EXPLORE_DAYS,
        now,
      }),
      q.userId
        ? this.store.listOwnRecentPostIds({
            userId: q.userId,
            since: new Date(sessionAt - OWN_RECENT_MS),
            until: new Date(sessionAt),
            postType: q.postType,
          })
        : Promise.resolve([]),
    ]);

    const ownSet = new Set(ownRecent);
    const ownItems: RankedItem[] = ownRecent.map((postId) => ({
      postId,
      authorId: q.userId!,
      score: 0,
      source: 'own',
      breakdown: {},
      reason: OWN_POST_REASON,
    }));
    const poolItems: RankedItem[] = pool
      .filter((c) => !ownSet.has(c.postId))
      .map((c) => ({
        postId: c.postId,
        authorId: c.authorId,
        score: 0,
        source: 'fresh',
        breakdown: {},
        reason: RECENT_REASON,
      }));

    const combined = [...ownItems, ...poolItems];
    const pageItems = combined.slice(offset, offset + q.limit);
    const nextOffset = offset + pageItems.length;
    const hasMore = combined.length > nextOffset;
    return {
      pageItems,
      algo: { name: 'recent' },
      nextCursor: pageItems.length > 0 && hasMore ? encodeCursor({ algo: 'recent', mode: 'recent', page: page + 1, offset: nextOffset, seenBefore }) : null,
    };
  }

  /** Bỏ bài đã ẩn hoặc không phát được sau khi qua FeedFacade.getByIds, giữ thứ tự xếp hạng. */
  private async hydrateReels(ranked: RankedItem[], viewerId: string | null): Promise<ReelRecommendationItem[]> {
    if (!ranked.length || !this.catalog.getReelCardsByIds) return [];
    const cards = await this.catalog.getReelCardsByIds(
      ranked.map((r) => r.postId),
      viewerId,
    );
    const byId = new Map(cards.map((c) => [c.postId, c]));
    return ranked.flatMap((r) => {
      const card = byId.get(r.postId);
      return card ? [{ card, source: r.source, reason: r.reason }] : [];
    });
  }

  /** Bỏ bài đã ẩn sau lần job gần nhất, giữ thứ tự xếp hạng. */
  private async hydrate(ranked: RankedItem[]): Promise<PostRecommendationItem[]> {
    if (!ranked.length) return [];
    const visible = new Map((await this.catalog.getVisiblePosts(ranked.map((r) => r.postId))).map((p) => [p.id, p]));
    return ranked.flatMap((r) => {
      const p = visible.get(r.postId);
      if (!p) return [];
      const post = { id: p.id, postType: p.postType, title: p.title, hashtags: p.hashtags, coverMediaId: p.coverMediaId, authorId: p.authorId, reactionTotal: p.reactionTotal };
      return [{ post, source: r.source, reason: r.reason }];
    });
  }

  /** Bộ ba đang bật của algo, cache 60 giây. Thiếu hoặc không khớp: log error, dùng trending. */
  private async loadAlgo(name: string): Promise<ResolvedAlgo> {
    const rows = await this.algoRows();
    for (const candidate of [name, 'trending']) {
      const row = rows.get(candidate);
      if (!row) {
        this.logger.error({ algo: candidate }, 'recommend_algos không có dòng đang bật, dùng trending');
        continue;
      }
      const resolved = resolveAlgo(row);
      if (resolved.ok) return resolved.algo;
      this.logger.error({ algo: candidate, error: resolved.error }, 'recommend_algos có bộ ba không hợp lệ, dùng trending');
    }
    const fallback = resolveAlgo(FALLBACK);
    if (!fallback.ok) throw new Error(fallback.error);
    return fallback.algo;
  }

  /** Hồ sơ chủ đề của từng nơi từ kiểu khách sạn, cache 10 phút như chu kỳ job; lỗi thì bỏ qua (ranker suy từ bài). */
  private async placeProfiles(): Promise<Map<string, Record<string, number>> | undefined> {
    if (this.placeProfileCache && Date.now() - this.placeProfileCache.at < PLACE_PROFILE_CACHE_MS) return this.placeProfileCache.profiles;
    try {
      const profiles = placeStyleProfiles(await this.store.listPlaceStyleCounts());
      this.placeProfileCache = { at: Date.now(), profiles };
      return profiles;
    } catch (err) {
      this.logger.warn({ err }, 'Đọc kiểu khách sạn theo nơi lỗi, bỏ hồ sơ nơi lượt này');
      return undefined;
    }
  }

  private async algoRows(): Promise<Map<string, AlgoRow>> {
    if (this.algoCache && Date.now() - this.algoCache.at < ALGO_CACHE_MS) return this.algoCache.rows;
    const rows = new Map((await this.store.listActiveAlgos()).map((r) => [r.name, r]));
    this.algoCache = { at: Date.now(), rows };
    return rows;
  }

  /** Redis lỗi thì vẫn trả kết quả, chỉ không đẩy bài đã xem xuống. */
  private async listSeen(userId: string, before: Date): Promise<string[]> {
    try {
      return await this.served.listBefore(userId, before);
    } catch (err) {
      this.logger.warn({ err }, 'Đọc bài đã phục vụ lỗi (Redis), bỏ đẩy bài đã xem xuống lượt này');
      return [];
    }
  }

  /** Redis lỗi thì bỏ gu trong phiên, vẫn dùng gu dài hạn. */
  /** Dữ liệu thô của người xem cho ranker cần nó: dòng 30 ngày + tỉnh của khách sạn trong đơn. Không xử lý gì ở đây. */
  private async loadViewer(userId: string, until: Date): Promise<ViewerRaw> {
    const rows = await this.store.listUserRows([userId], until);
    const productIds = [...new Set(rows.flatMap((r) => (r.kind === 'order_item' && r.targetId ? [r.targetId] : [])))];
    const postIds = [
      ...new Set(
        rows.flatMap((r) => {
          const source = r.detail?.sourcePostId;
          return [r.targetType === 'post' && r.targetId ? r.targetId : null, typeof source === 'string' ? source : null].filter((id): id is string => id !== null);
        }),
      ),
    ];
    // Đơn ghi mã loại phòng (`<khách sạn>--<phòng>`), bảng đặc trưng lưu nơi theo khách sạn: tra cả hai.
    const lookupIds = [...new Set([...productIds, ...productIds.map(hotelIdOfProduct)])];
    const [productPlaces, metas] = await Promise.all([this.store.findProductPlaces(lookupIds), this.store.findPostMetas(postIds)]);
    return { rows, productPlaces, posts: Object.fromEntries(metas.map((m) => [m.postId, m])) };
  }

  private async listRecent(userId: string, until: Date): Promise<Array<{ postId: string; at: number }>> {
    try {
      return await this.recentPosts.list(userId, until);
    } catch (err) {
      this.logger.warn({ err }, 'Đọc bài vừa tương tác lỗi (Redis), bỏ gu trong phiên lượt này');
      return [];
    }
  }

  private async withSessionTaste(
    longTaste: Record<string, unknown> | null,
    recent: Array<{ postId: string; at: number }>,
    sessionAt: number,
  ): Promise<Record<string, unknown> | null> {
    if (!recent.length) return longTaste;
    const metas = new Map((await this.store.findPostMetas(recent.map((r) => r.postId))).map((m) => [m.postId, m]));
    const withMeta = recent.flatMap((r) => {
      const meta = metas.get(r.postId);
      return meta ? [{ meta, at: r.at }] : [];
    });
    return blendSessionTaste(longTaste, withMeta, sessionAt);
  }

  private async recordSeen(userId: string, postIds: string[], at: Date): Promise<void> {
    try {
      await this.served.add(userId, postIds, at);
    } catch (err) {
      this.logger.warn({ err }, 'Ghi bài đã phục vụ lỗi (Redis)');
    }
  }
}
