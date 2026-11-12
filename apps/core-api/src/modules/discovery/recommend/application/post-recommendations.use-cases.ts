import { Inject, Injectable, Logger } from '@nestjs/common';
import { exploreSlots, interleave, mergeCandidates, pickExplore } from '../domain/candidates.js';
import type { CandidateSource, RankedItem } from '../domain/contracts.js';
import { resolveAlgo, type AlgoRow, type ResolvedAlgo } from '../domain/registry.js';
import { blendSessionTaste } from '../domain/session-taste.js';
import {
  RECENT_POSTS_STORE,
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  SERVED_STORE,
  type RecommendCardPost,
  type RecentPostsStore,
  type RecommendCatalog,
  type RecommendStore,
  type ServedStore,
} from './ports.js';

export type RecommendMode = 'for_you' | 'trending';

const ALGO_CACHE_MS = 60_000;
const HOT_LIMIT = 150;
const FRESH_LIMIT = 50;
const FRESH_HOURS = 48;
const EXPLORE_POOL_LIMIT = 500;
const EXPLORE_DAYS = 30;
/** Bộ ba dự phòng khi dòng trending trong DB cũng hỏng: endpoint không bao giờ chết vì cấu hình. */
const FALLBACK: AlgoRow = { name: 'trending', postBuilder: 'hot@v0', userBuilder: 'none@v0', ranker: 'popular_v0' };

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

/** Bài gợi ý trước mốc này tính là "phiên trước" và bị đẩy xuống cuối; bài gợi ý trong phiên giữ chỗ. */
const SESSION_MS = 30 * 60_000;

/** Cursor do server cấp: giữ thuật toán, offset và mốc "phiên trước" của trang đầu. */
interface Cursor {
  algo: string;
  page: number;
  offset: number;
  seenBefore: number;
}

/** Bài đã xem ở phiên trước xuống cuối, giữ thứ tự xếp hạng trong từng nhóm. Kho ít bài thì vẫn còn bài để xem. */
const demoteSeen = (ranked: RankedItem[], seen: Set<string>): RankedItem[] =>
  seen.size ? [...ranked.filter((r) => !seen.has(r.postId)), ...ranked.filter((r) => seen.has(r.postId))] : ranked;

export class InvalidRecommendCursorError extends Error {}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Partial<Cursor>;
    if (
      typeof c.algo === 'string' &&
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

/** Gợi ý bài viết (đề xuất recommend-offline mục 6): không đọc bảng thô, không ghi Postgres. */
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
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    // Khách không có gu: for_you của khách là trending.
    const algoName = cursor?.algo ?? (q.userId ? q.mode : 'trending');
    const algo = await this.loadAlgo(algoName);
    const page = cursor?.page ?? 0;
    const offset = cursor?.offset ?? 0;
    // Mốc "phiên trước" cố định từ trang đầu: cả phiên đẩy xuống cùng một tập bài nên trang không xô lệch.
    const seenBefore = cursor?.seenBefore ?? now.getTime() - SESSION_MS;
    // Gu trong phiên chốt theo lúc tải trang đầu: tương tác giữa chừng có hiệu lực ở lần tải feed sau, trang không xô lệch.
    const sessionAt = seenBefore + SESSION_MS;

    const [interacted, seenIds, longTaste, recent] = q.userId
      ? await Promise.all([
          this.store.listInteractedPostIds(q.userId, now),
          this.listSeen(q.userId, new Date(seenBefore)),
          this.store.findUserFeatures(algo.userBuilder.key, q.userId),
          algo.userBuilder.key === 'tag_affinity@v0' ? this.listRecent(q.userId, new Date(sessionAt)) : [],
        ])
      : [[], [], null, []];
    const userFeatures = await this.withSessionTaste(longTaste, recent, sessionAt);
    const seen = new Set(seenIds);
    const base = { postBuilder: algo.postBuilder.key, postType: q.postType, excludePostIds: interacted, now };
    const [hot, fresh] = await Promise.all([
      this.store.listHotCandidates({ ...base, limit: HOT_LIMIT }),
      this.store.listFreshCandidates({ ...base, limit: FRESH_LIMIT, hours: FRESH_HOURS }),
    ]);
    const candidates = mergeCandidates(hot, fresh);
    const inCandidates = new Set(candidates.map((c) => c.postId));
    const explorePool = (await this.store.listExplorePool({ ...base, limit: EXPLORE_POOL_LIMIT, days: EXPLORE_DAYS })).filter(
      (c) => !inCandidates.has(c.postId) && !seen.has(c.postId),
    );

    const slots = exploreSlots(q.limit);
    const ranked = demoteSeen(algo.ranker.rank({ candidates, userFeatures, now }), seen);
    const explore = pickExplore(explorePool, { userKey: q.userId ?? 'guest', day: now.toISOString().slice(0, 10) }, slots, page * slots);
    // Kho explore thiếu (ít bài, mọi bài đã là ứng viên hot) thì lấp chỗ trống bằng bài đã xếp hạng.
    const rankedTake = ranked.slice(offset, offset + q.limit - explore.length);
    const pageItems = interleave(rankedTake, explore, q.limit);

    const items = await this.hydrate(pageItems);
    if (q.userId) await this.recordSeen(q.userId, pageItems.map((i) => i.postId), now);
    for (const item of items) {
      this.logger.log({ mode: q.mode, algo: algo.name, source: item.source, postId: item.post.id }, 'recommend.served');
    }

    // Phân trang bằng offset cho mọi người: gọi lại cùng cursor (tải lại sau khi thả tim) ra cùng trang.
    // ponytail: bài vừa tương tác rời danh sách ngay nên trang sau có thể hụt một bài; chấp nhận ở v0.
    const nextOffset = offset + rankedTake.length;
    const hasMore = ranked.length > nextOffset || explorePool.length > (page + 1) * slots;
    return {
      items,
      algo: algo.name,
      nextCursor: pageItems.length > 0 && hasMore ? encodeCursor({ algo: algo.name, page: page + 1, offset: nextOffset, seenBefore }) : null,
    };
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
