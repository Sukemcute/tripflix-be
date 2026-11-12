import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostBuilder, PostMeta, RawRow, UserBuilder } from '../domain/contracts.js';
import { placeIdOfPost } from '../domain/place-of-post.js';
import { resolveAlgo } from '../domain/registry.js';
import { RECOMMEND_CATALOG, RECOMMEND_STORE, type RecommendCatalog, type RecommendPostRow, type RecommendStore } from './ports.js';

const LOCK = 'discovery.recommend-features';
const JOB = 'build-features';
const USER_BATCH = 200;

export interface BuildCycleResult {
  posts: number;
  users: number;
  failedBuilders: string[];
}

async function readAll<T>(page: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const next = await page(cursor);
    all.push(...next.items);
    cursor = next.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Bộ điều phối tính đặc trưng (đề xuất recommend-offline mục 5.6). Bước 1 dựng lại toàn bộ mỗi chu kỳ:
 * đồng bộ recommend_posts từ listPosts → mọi post builder trên MỘT lô gồm mọi bài (chuẩn hoá điểm trên toàn bộ)
 * → mọi user builder cho người có dòng thô 30 ngày, lô 200. Builder lỗi: giữ dữ liệu cũ, ghi last_error, chạy tiếp.
 */
@Injectable()
export class BuildFeaturesUseCases {
  private readonly logger = new Logger(BuildFeaturesUseCases.name);

  constructor(
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RECOMMEND_CATALOG) private readonly catalog: RecommendCatalog,
  ) {}

  /** null = worker khác đang chạy hoặc content tạm rỗng, bỏ lượt. */
  runCycle(now = new Date()): Promise<BuildCycleResult | null> {
    return this.store.withLock(LOCK, () => this.build(now)).then((r) => r ?? null);
  }

  private async build(now: Date): Promise<BuildCycleResult | null> {
    const [sourcePosts, hotels] = await Promise.all([
      readAll((c) => this.catalog.listPosts(c)),
      readAll((c) => this.catalog.listHotelProvinces(c)),
    ]);
    const hotelProvinces = new Map(hotels.map((h) => [h.id, h.provinceSlug]));
    const posts: RecommendPostRow[] = sourcePosts.map((p) => ({
      postId: p.id,
      authorId: p.authorId,
      postType: p.postType,
      tags: p.hashtags,
      placeId: placeIdOfPost(
        { hotelId: p.tripAttachment?.hotelId ?? null, destinationName: p.tripAttachment?.destinationName ?? null, title: p.title },
        hotelProvinces,
      ),
      isVerified: p.isVerified,
      publishedAt: p.createdAt,
    }));
    if (!(await this.store.replacePosts(posts))) {
      this.logger.warn('listPosts trả 0 bài (content tạm rỗng?), giữ dữ liệu gợi ý cũ, bỏ lượt');
      return null;
    }

    const { postBuilders, userBuilders } = await this.activeBuilders();
    const failedBuilders: string[] = [];

    const counts = await this.store.countPostInteractions(now);
    const items = posts.map((p) => ({
      postId: p.postId,
      authorId: p.authorId,
      postType: p.postType,
      tags: p.tags,
      placeId: p.placeId,
      publishedAt: p.publishedAt.toISOString(),
      interactions: counts.get(p.postId)?.d30 ?? {},
      interactions24h: counts.get(p.postId)?.h24 ?? {},
    }));
    for (const builder of postBuilders) {
      await this.runBuilder(builder.key, now, failedBuilders, async () => {
        const out = await builder.build(items, now);
        for (const o of out) builder.featuresSchema.parse(o.features);
        const postType = new Map(posts.map((p) => [p.postId, p.postType]));
        await this.store.replacePostScores(
          builder.key,
          out.filter((o) => postType.has(o.postId)).map((o) => ({ ...o, postType: postType.get(o.postId)! })),
        );
      });
    }

    const userIds = await this.store.listActiveUserIds(now);
    const metaById = new Map<string, PostMeta>(posts.map(({ postId, authorId, postType, tags, placeId }) => [postId, { postId, authorId, postType, tags, placeId }]));
    const productPlaces = Object.fromEntries(hotelProvinces);
    for (const builder of userBuilders) {
      await this.runBuilder(builder.key, now, failedBuilders, async () => {
        for (let i = 0; i < userIds.length; i += USER_BATCH) {
          const batch = userIds.slice(i, i + USER_BATCH);
          const rowsByUser = groupBy(await this.store.listUserRows(batch, now), (r) => r.actorId);
          const input = batch.map((userId) => {
            const rows = rowsByUser.get(userId) ?? [];
            return { userId, rows, posts: touchedPosts(rows, metaById), productPlaces };
          });
          const out = await builder.build(input, now);
          for (const o of out) builder.featuresSchema.parse(o.features);
          await this.store.upsertUserFeatures(builder.key, out);
        }
      });
    }

    await this.store.setJobState(JOB, { lastRunAt: now, lastError: failedBuilders.length ? `Builder lỗi: ${failedBuilders.join(', ')}` : null, watermark: now });
    return { posts: posts.length, users: userIds.length, failedBuilders };
  }

  /** Builder mà các dòng recommend_algos đang bật dùng; dòng có bộ ba sai thì bỏ (endpoint cũng từ chối). */
  private async activeBuilders(): Promise<{ postBuilders: PostBuilder[]; userBuilders: UserBuilder[] }> {
    const postBuilders = new Map<string, PostBuilder>();
    const userBuilders = new Map<string, UserBuilder>();
    for (const row of await this.store.listActiveAlgos()) {
      const resolved = resolveAlgo(row);
      if (!resolved.ok) {
        this.logger.error({ algo: row.name, error: resolved.error }, 'recommend_algos có bộ ba không hợp lệ, bỏ qua khi tính đặc trưng');
        continue;
      }
      postBuilders.set(resolved.algo.postBuilder.key, resolved.algo.postBuilder);
      userBuilders.set(resolved.algo.userBuilder.key, resolved.algo.userBuilder);
    }
    return { postBuilders: [...postBuilders.values()], userBuilders: [...userBuilders.values()] };
  }

  private async runBuilder(key: string, now: Date, failed: string[], run: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();
    try {
      await run();
      await this.store.setJobState(key, { lastRunAt: now, lastError: null });
      this.logger.log(`Builder ${key}: ${Date.now() - startedAt} ms`);
    } catch (error) {
      // Giữ dữ liệu cũ của builder này (replacePostScores chạy trong transaction), chạy tiếp builder khác.
      failed.push(key);
      const message = (error as Error).message;
      await this.store.setJobState(key, { lastRunAt: now, lastError: message.slice(0, 2000) });
      this.logger.error({ builder: key, err: error }, `Builder ${key} lỗi, giữ dữ liệu cũ`);
    }
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** Bài mà các dòng nhắm tới (target post hoặc detail.sourcePostId / detail.postId). */
function touchedPosts(rows: RawRow[], metaById: ReadonlyMap<string, PostMeta>): Record<string, PostMeta> {
  const out: Record<string, PostMeta> = {};
  for (const r of rows) {
    for (const id of [r.targetId, r.detail?.sourcePostId, r.detail?.postId]) {
      const meta = typeof id === 'string' ? metaById.get(id) : undefined;
      if (meta) out[meta.postId] = meta;
    }
  }
  return out;
}
