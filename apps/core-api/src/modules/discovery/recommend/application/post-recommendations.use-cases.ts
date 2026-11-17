import { Inject, Injectable, Logger } from '@nestjs/common';
import { exploreSlots, interleave, mergeCandidates, pickExplore } from '../domain/candidates.js';
import type { CandidateSource, RankedItem } from '../domain/contracts.js';
import { applyFeedPolicy, OWN_POST_REASON } from '../domain/feed-policy.js';
import { resolveAlgo, type AlgoRow, type ResolvedAlgo } from '../domain/registry.js';
import { blendSessionTaste } from '../domain/session-taste.js';
import {
  RECENT_POSTS_STORE,
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  SERVED_STORE,
  type RecommendCardPost,
  type RecommendReelCard,
  type RecentPostsStore,
  type RecommendCatalog,
  type RecommendStore,
  type ServedStore,
} from './ports.js';

export type RecommendMode = 'for_you' | 'trending' | 'has_plan' | 'recent';

const RECENT_REASON = { code: 'recent', text: 'Mới đăng' };

const ALGO_CACHE_MS = 60_000;
const HOT_LIMIT = 150;
const FRESH_LIMIT = 50;
const FRESH_HOURS = 48;
const EXPLORE_POOL_LIMIT = 500;
const EXPLORE_DAYS = 30;
/** Bộ ba dự phòng khi dòng trending trong DB cũng hỏng: endpoint không bao giờ chết vì cấu hình. */
const FALLBACK: AlgoRow = { name: 'trending', postBuilder: 'hot@v1', userBuilder: 'none@v0', ranker: 'popular_v0' };

export interface PostRecommendationQuery {
  mode: RecommendMode;
  postType: string | null;
  limit: number;
  cursor: string | null;
  userId: string | null;
  now?: Date;
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
}

/** Bài tự đăng trong khoảng này trước trang đầu được đưa lên đầu feed của chính người đăng. */
const OWN_RECENT_MS = 60 * 60_000;

export class InvalidRecommendCursorError extends Error {}

const VALID_MODES = new Set<RecommendMode>(['for_you', 'trending', 'has_plan', 'recent']);

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
      c.page! >= 0 &&
      c.offset! >= 0
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

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RECOMMEND_CATALOG) private readonly catalog: RecommendCatalog,
    @Inject(SERVED_STORE) private readonly served: ServedStore,
    @Inject(RECENT_POSTS_STORE) private readonly recentPosts: RecentPostsStore,
  ) {}

  async recommend(q: PostRecommendationQuery): Promise<PostRecommendationPage> {
    const now = q.now ?? new Date();
    const { pageItems, algo, nextCursor } = await this.selectRankedPage(q, now);

    const items = await this.hydrate(pageItems);
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
    const { pageItems, algo, nextCursor } = await this.selectRankedPage({ ...q, postType: 'video' }, now);

    const items = await this.hydrateReels(pageItems, q.userId);
    if (q.userId && items.length) {
      await this.recordSeen(q.userId, items.map((i) => i.card.postId), now);
    }
    for (const item of items) {
      this.logger.log({ mode: q.mode, algo: algo.name, source: item.source, postId: item.card.postId }, 'recommend.served');
    }

    return { items, algo: algo.name, nextCursor };
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
    // Gu trong phiên chốt theo lúc tải trang đầu: tương tác giữa chừng có hiệu lực ở lần tải feed sau, trang không xô lệch.
    const sessionAt = seenBefore + SESSION_MS;
    const hasPlanOnly = mode === 'has_plan';

    // Mọi tín hiệu người xem chốt theo trang đầu (sessionAt): tương tác giữa phiên không làm trang sau xô lệch.
    const [interacted, seenIds, longTaste, recent, rawOwnRecent] = q.userId
      ? await Promise.all([
          this.store.listInteractedPostIds(q.userId, new Date(sessionAt)),
          this.listSeen(q.userId, new Date(seenBefore)),
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
    const [hot, fresh] = await Promise.all([
      this.store.listHotCandidates({ ...base, limit: HOT_LIMIT }),
      this.store.listFreshCandidates({ ...base, limit: FRESH_LIMIT, hours: FRESH_HOURS }),
    ]);
    const candidates = mergeCandidates(hot, fresh);
    const inCandidates = new Set(candidates.map((c) => c.postId));
    const explorePool = (
      await this.store.listExplorePool({ ...base, excludePostIds: interacted, limit: EXPLORE_POOL_LIMIT, days: EXPLORE_DAYS })
    ).filter(
      (c) => !inCandidates.has(c.postId) && !seen.has(c.postId),
    );

    const slots = exploreSlots(q.limit);
    // Bài vừa đăng chưa qua job thì chưa là ứng viên: thêm thẳng, tầng chính sách đưa lên đầu.
    const ownExtra: RankedItem[] = ownRecent
      .filter((postId) => !inCandidates.has(postId))
      .map((postId) => ({ postId, authorId: q.userId!, score: 0, source: 'own', breakdown: {}, reason: OWN_POST_REASON }));
    const ranked = applyFeedPolicy([...algo.ranker.rank({ candidates, userFeatures, now }), ...ownExtra], {
      userId: q.userId,
      seen,
      interacted: new Set(interacted),
      ownRecent: new Set(ownRecent),
    });
    const explore = pickExplore(explorePool, { userKey: q.userId ?? 'guest', day: now.toISOString().slice(0, 10) }, slots, page * slots);
    // Kho explore thiếu (ít bài, mọi bài đã là ứng viên hot) thì lấp chỗ trống bằng bài đã xếp hạng.
    const rankedTake = ranked.slice(offset, offset + q.limit - explore.length);
    const pageItems = interleave(rankedTake, explore, q.limit);

    // Phân trang bằng offset cho mọi người: gọi lại cùng cursor (tải lại sau khi thả tim) ra cùng trang.
    const nextOffset = offset + rankedTake.length;
    const hasMore = ranked.length > nextOffset || explorePool.length > (page + 1) * slots;
    return {
      pageItems,
      algo,
      nextCursor: pageItems.length > 0 && hasMore ? encodeCursor({ algo: algo.name, mode, page: page + 1, offset: nextOffset, seenBefore }) : null,
    };
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
