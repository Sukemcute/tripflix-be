import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { captionExpOf, captionOf, EXP_DESCRIPTION_TEXTS } from '../domain/bins.js';
import { calculateCompleteness, hasPlan } from '../../../content/index.js';
import { round4, type PostBuilder, type PostContent, type PostMeta, type RawRow, type UserBuilder } from '../domain/contracts.js';
import { groupBy } from '../domain/group-by.js';
import { placeIdOfPost } from '../domain/place-of-post.js';
import { resolveAlgo } from '../domain/registry.js';
import { CAPTION_MODEL } from '../domain/topics.js';
import {
  RECOMMEND_CATALOG,
  RECOMMEND_STORE,
  TEXT_EMBEDDER,
  type RecommendCatalog,
  type RecommendPostRow,
  type RecommendSourcePost,
  type RecommendStore,
  type TextEmbedder,
} from './ports.js';

const LOCK = 'discovery.recommend-features';
const JOB = 'build-features';
const USER_BATCH = 200;
/** Một lượt quá lâu thì dừng phần người dùng: người chưa tính giữ đặc trưng cũ, lỗi hiện ở Admin Jobs thay vì giữ worker hàng giờ. */
export const BUILD_BUDGET_MS = 5 * 60_000;
/** Trả lượt cho event loop giữa các lô: APP_ROLE=all thì request API không phải chờ hết job. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Văn bản mới nhúng tối đa mỗi chu kỳ (~45 giây ở ai-service 0,5 CPU; 42k bài backfill ~3,5 giờ); phần còn lại để chu kỳ sau. */
const EMBED_PER_CYCLE = 2048;
/** Số caption đọc vector mỗi lần: một câu IN vừa phải, và RAM chỉ giữ vector của một lô. */
const VECTOR_READ_CHUNK = 1000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

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

const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Nội dung thô của bài cho builder (không có logic thuật toán). items của lộ trình là unknown[] ở cổng: chỉ đọc location, category. */
function contentOf(p: RecommendSourcePost | undefined): PostContent | undefined {
  if (!p) return undefined;
  const trip = p.tripAttachment;
  return {
    title: p.title,
    body: p.body,
    isVerified: p.isVerified,
    trip: trip
      ? {
          hotelId: strOrNull(trip.hotelId),
          destinationName: strOrNull(trip.destinationName),
          daysCount: numOrNull(trip.daysCount),
          estimatedCostPerPerson: numOrNull(trip.estimatedCostPerPerson),
          items: (trip.items ?? []).map((i) => {
            const item = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
            return { location: strOrNull(item.location), category: strOrNull(item.category) };
          }),
        }
      : null,
  };
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
    @Optional() @Inject(TEXT_EMBEDDER) private readonly embedder?: TextEmbedder,
  ) {}

  /**
   * Vector của các văn bản: đọc cache trước, thiếu thì nhúng tối đa `budget` văn bản qua ai-service rồi ghi cache.
   * Vector của mô hình khác CAPTION_MODEL bị bỏ vì biên đo trên mô hình đó.
   */
  private async vectorsOf(texts: string[], budget: number): Promise<{ vectors: Map<string, number[]>; embedded: number }> {
    const hashes = texts.map(sha256);
    const byHash = await this.store.findTextVectors(CAPTION_MODEL, [...new Set(hashes)]);
    const missing = [...new Set(texts.filter((_, i) => !byHash.has(hashes[i]!)))].slice(0, budget);
    if (missing.length) {
      const embedded = await this.embedder!.embed(missing);
      if (embedded?.model === CAPTION_MODEL) {
        const rows = missing.map((t, i) => ({ textHash: sha256(t), vector: embedded.vectors[i]! }));
        await this.store.insertTextVectors(CAPTION_MODEL, rows);
        for (const r of rows) byHash.set(r.textHash, r.vector);
      } else if (embedded) {
        throw new Error(`ai-service nhúng bằng ${embedded.model}, cần ${CAPTION_MODEL}`);
      }
    }
    const vectors = new Map(texts.flatMap((t, i) => (byHash.has(hashes[i]!) ? [[t, byHash.get(hashes[i]!)!] as const] : [])));
    return { vectors, embedded: missing.length };
  }

  /**
   * Gắn content.captionExp cho từng bài (đầu vào nguồn caption của bins.ts). Bài mới trước: nhúng chưa kịp thì bài cũ
   * chờ chu kỳ sau. Đọc vector theo lô và bỏ ngay sau khi so với mô tả ngăn. Lỗi gì cũng chỉ mất nguồn caption, job chạy tiếp.
   */
  private async resolveCaptionBins(postsNewestFirst: Array<{ content: PostContent | undefined }>): Promise<void> {
    if (!this.embedder) return;
    try {
      const descriptions = (await this.vectorsOf([...EXP_DESCRIPTION_TEXTS], EXP_DESCRIPTION_TEXTS.length)).vectors;
      if (descriptions.size < EXP_DESCRIPTION_TEXTS.length) return;
      const descriptionVectors = EXP_DESCRIPTION_TEXTS.map((t) => descriptions.get(t)!);
      const byCaption = new Map<string, PostContent[]>();
      for (const { content } of postsNewestFirst) {
        const caption = captionOf(content);
        if (!caption || !content) continue;
        const list = byCaption.get(caption);
        if (list) list.push(content);
        else byCaption.set(caption, [content]);
      }
      const captions = [...byCaption.keys()];
      let budget = EMBED_PER_CYCLE;
      for (let i = 0; i < captions.length; i += VECTOR_READ_CHUNK) {
        const { vectors, embedded } = await this.vectorsOf(captions.slice(i, i + VECTOR_READ_CHUNK), budget);
        budget -= embedded;
        for (const [caption, vector] of vectors) {
          const bin = captionExpOf(vector, descriptionVectors);
          for (const content of byCaption.get(caption)!) content.captionExp = bin;
        }
      }
    } catch (err) {
      this.logger.warn(`Không lấy được vector caption, bỏ nguồn caption: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** null = worker khác đang chạy hoặc content tạm rỗng, bỏ lượt. */
  runCycle(now = new Date(), budgetMs = BUILD_BUDGET_MS): Promise<BuildCycleResult | null> {
    return this.store.withLock(LOCK, () => this.build(now, Date.now() + budgetMs)).then((r) => r ?? null);
  }

  private async build(now: Date, deadline: number): Promise<BuildCycleResult | null> {
    const [sourcePosts, hotels] = await Promise.all([
      readAll((c) => this.catalog.listPosts(c)),
      readAll((c) => this.catalog.listHotelProvinces(c)),
    ]);
    const hotelProvinces = new Map(hotels.map((h) => [h.id, h.provinceSlug]));
    const completenessById = new Map<string, number>();
    const contentById = new Map(sourcePosts.map((p) => [p.id, contentOf(p)]));
    const posts: RecommendPostRow[] = sourcePosts.map((p) => {
      completenessById.set(p.id, calculateCompleteness(p));
      const content = contentById.get(p.id);
      return {
        postId: p.id,
        authorId: p.authorId,
        postType: p.postType,
        tags: p.hashtags,
        placeId: placeIdOfPost(
          {
            hotelId: p.tripAttachment?.hotelId ?? null,
            tags: p.hashtags,
            destinationName: p.tripAttachment?.destinationName ?? null,
            title: p.title,
            body: p.body,
            items: content?.trip?.items,
          },
          hotelProvinces,
        ),
        isVerified: p.isVerified,
        hasPlan: hasPlan(p),
        publishedAt: p.createdAt,
      };
    });
    if (!(await this.store.replacePosts(posts))) {
      this.logger.warn('listPosts trả 0 bài (content tạm rỗng?), giữ dữ liệu gợi ý cũ, bỏ lượt');
      return null;
    }

    const { postBuilders, userBuilders } = await this.activeBuilders();
    const failedBuilders: string[] = [];

    const needsSamples = postBuilders.some((b) => b.needsSamples);
    // Chỉ nhúng khi builder đang bật đọc ngăn từ caption (v0 thì không gọi AI, không đọc cache).
    const needsVectors = [...postBuilders, ...userBuilders].some((b) => b.needsVectors);
    if (needsVectors) {
      const newestFirst = [...sourcePosts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      await this.resolveCaptionBins(newestFirst.map((p) => ({ content: contentById.get(p.id) })));
    }
    const [counts, samples] = await Promise.all([
      this.store.countPostInteractions(now),
      needsSamples ? this.store.listPostInteractionSamples(now) : Promise.resolve(null),
    ]);
    const items = posts.map((p) => ({
      postId: p.postId,
      authorId: p.authorId,
      postType: p.postType,
      tags: p.tags,
      placeId: p.placeId,
      publishedAt: p.publishedAt.toISOString(),
      completeness: completenessById.get(p.postId) ?? 0,
      hasPlan: p.hasPlan,
      interactions: counts.get(p.postId)?.d30 ?? {},
      interactions24h: counts.get(p.postId)?.h24 ?? {},
      ...(samples ? { interactionSamples: samples.get(p.postId) ?? [] } : {}),
      content: contentById.get(p.postId),
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
    const metaById = new Map<string, PostMeta>(
      posts.map(({ postId, authorId, postType, tags, placeId }) => [
        postId,
        { postId, authorId, postType, tags, placeId, content: contentById.get(postId) },
      ]),
    );
    const productPlaces = Object.fromEntries(hotelProvinces);
    for (const builder of userBuilders) {
      await this.runBuilder(builder.key, now, failedBuilders, async () => {
        for (let i = 0; i < userIds.length; i += USER_BATCH) {
          if (Date.now() > deadline) {
            throw new Error(`Quá ngân sách thời gian của lượt, mới tính ${i}/${userIds.length} người; phần còn lại giữ đặc trưng cũ`);
          }
          if (i > 0) await yieldToEventLoop();
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
    const unresolved = posts.filter((p) => p.placeId === null).length;
    this.logger.log({ total: posts.length, unresolved, ratio: round4(unresolved / posts.length) }, 'recommend.place_unresolved_ratio');
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
