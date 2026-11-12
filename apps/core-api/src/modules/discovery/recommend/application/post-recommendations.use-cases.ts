import { Inject, Injectable, Logger } from '@nestjs/common';
import { exploreSlots, interleave, mergeCandidates, pickExplore } from '../domain/candidates.js';
import type { CandidateSource, RankedItem } from '../domain/contracts.js';
import { resolveAlgo, type AlgoRow, type ResolvedAlgo } from '../domain/registry.js';
import {
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  SERVED_STORE,
  type RecommendCardPost,
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

/** Cursor do server cấp: giữ thuật toán của trang đầu; khách thì mang offset (không có chống lặp Redis). */
interface Cursor {
  algo: string;
  page: number;
  offset: number;
}

export class InvalidRecommendCursorError extends Error {}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Partial<Cursor>;
    if (typeof c.algo === 'string' && Number.isInteger(c.page) && Number.isInteger(c.offset) && c.page! >= 0 && c.offset! >= 0) {
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
  ) {}

  async recommend(q: PostRecommendationQuery): Promise<PostRecommendationPage> {
    const now = q.now ?? new Date();
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    // Khách không có gu: for_you của khách là trending.
    const algoName = cursor?.algo ?? (q.userId ? q.mode : 'trending');
    const algo = await this.loadAlgo(algoName);
    const page = cursor?.page ?? 0;
    const offset = cursor?.offset ?? 0;

    const [interacted, servedIds, userFeatures] = q.userId
      ? await Promise.all([
          this.store.listInteractedPostIds(q.userId, now),
          this.listServed(q.userId),
          this.store.findUserFeatures(algo.userBuilder.key, q.userId),
        ])
      : [[], [], null];
    const base = { postBuilder: algo.postBuilder.key, postType: q.postType, excludePostIds: [...new Set([...interacted, ...servedIds])], now };
    const [hot, fresh] = await Promise.all([
      this.store.listHotCandidates({ ...base, limit: HOT_LIMIT }),
      this.store.listFreshCandidates({ ...base, limit: FRESH_LIMIT, hours: FRESH_HOURS }),
    ]);
    const candidates = mergeCandidates(hot, fresh);
    const inCandidates = new Set(candidates.map((c) => c.postId));
    const explorePool = (await this.store.listExplorePool({ ...base, limit: EXPLORE_POOL_LIMIT, days: EXPLORE_DAYS })).filter(
      (c) => !inCandidates.has(c.postId),
    );

    const slots = exploreSlots(q.limit);
    const ranked = algo.ranker.rank({ candidates, userFeatures, now });
    const rankedTake = ranked.slice(offset, offset + q.limit - slots);
    const explore = pickExplore(explorePool, { userKey: q.userId ?? 'guest', day: now.toISOString().slice(0, 10) }, slots, q.userId ? 0 : page * slots);
    const pageItems = interleave(rankedTake, explore, q.limit);

    const items = await this.hydrate(pageItems);
    if (q.userId) await this.recordServed(q.userId, pageItems.map((i) => i.postId));
    for (const item of items) {
      this.logger.log({ mode: q.mode, algo: algo.name, source: item.source, postId: item.post.id }, 'recommend.served');
    }

    // Người dùng: trang sau loại bài đã phục vụ nên không cần offset. Khách: cộng offset.
    const hasMore = ranked.length > offset + rankedTake.length || explorePool.length > (q.userId ? slots : (page + 1) * slots);
    const nextOffset = q.userId ? 0 : offset + rankedTake.length;
    return {
      items,
      algo: algo.name,
      nextCursor: pageItems.length === q.limit && hasMore ? encodeCursor({ algo: algo.name, page: page + 1, offset: nextOffset }) : null,
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

  /** Redis lỗi thì vẫn trả kết quả, chỉ mất chống lặp. */
  private async listServed(userId: string): Promise<string[]> {
    try {
      return await this.served.list(userId);
    } catch (err) {
      this.logger.warn({ err }, 'Đọc bài đã phục vụ lỗi (Redis), bỏ chống lặp lượt này');
      return [];
    }
  }

  private async recordServed(userId: string, postIds: string[]): Promise<void> {
    try {
      await this.served.add(userId, postIds);
    } catch (err) {
      this.logger.warn({ err }, 'Ghi bài đã phục vụ lỗi (Redis)');
    }
  }
}
