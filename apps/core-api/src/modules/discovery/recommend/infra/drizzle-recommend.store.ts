import type { Db } from '@tripflix/db';
import { and, desc, eq, gt, inArray, isNotNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import pg from 'pg';
import {
  recommendAlgos,
  recommendProductFeatures,
  recommendInteractions,
  recommendJobState,
  recommendPostScores,
  recommendPosts,
  recommendTextVectors,
  recommendUserFeatures,
} from '../../db/schema/index.js';
import type { CandidateQuery, InteractionCounts, ProductFeatureStore, RecommendAdminStats, RecommendPostRow, RecommendStore } from '../application/ports.js';
import { splitKey, type Candidate, type CandidateSource, type Kind, type ProductBuildOutput, type ProductType, type PostInteractionSample, type PostMeta, type RawRow } from '../domain/contracts.js';
import type { OrderCancellation } from '../domain/ingest/to-raw-rows.js';
import { APPEND_ONLY_KEEP, APPEND_ONLY_KINDS, OTHER_KIND_READ_CAP } from '../domain/row-limits.js';

const CHUNK = 1000;
const DAY_MS = 86_400_000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);
const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

/** Hạn lưu bảng thô (đề xuất mục 4). Dòng thêm mới (ref = eventId) giữ ngắn hơn dòng trạng thái. */
const RETENTION = { removedDays: 7, appendOnlyDays: 90, otherDays: 180 };

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export class DrizzleRecommendStore implements RecommendStore, ProductFeatureStore {
  constructor(private readonly db: Db) {}

  async upsertInteractions(rows: RawRow[], meta: { source: string; eventId: string }): Promise<void> {
    if (!rows.length) return;
    await this.db
      .insert(recommendInteractions)
      .values(rows.map((r) => ({ ...r, occurredAt: new Date(r.occurredAt), source: meta.source, sourceEventId: meta.eventId })))
      .onConflictDoUpdate({
        target: [recommendInteractions.actorType, recommendInteractions.actorId, recommendInteractions.kind, recommendInteractions.refId],
        set: {
          targetType: excluded('target_type'),
          targetId: excluded('target_id'),
          value: excluded('value'),
          isRemoved: excluded('is_removed'),
          detail: excluded('detail'),
          occurredAt: excluded('occurred_at'),
          source: excluded('source'),
          sourceEventId: excluded('source_event_id'),
          ingestedAt: sql`now()`,
        },
        setWhere: sql`excluded."occurred_at" > ${recommendInteractions.occurredAt}`,
      });
  }

  async cancelOrderItems(c: OrderCancellation): Promise<number> {
    const updated = await this.db
      .update(recommendInteractions)
      .set({ isRemoved: true, ingestedAt: sql`now()` })
      .where(
        and(
          eq(recommendInteractions.actorType, 'user'),
          eq(recommendInteractions.actorId, c.userId),
          eq(recommendInteractions.kind, 'order_item'),
          sql`${recommendInteractions.refId} like ${`${c.orderId}:%`}`,
          sql`${recommendInteractions.occurredAt} < ${new Date(c.occurredAt)}`,
        ),
      )
      .returning({ refId: recommendInteractions.refId });
    return updated.length;
  }

  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    // Khoá theo phiên cần giữ đúng một kết nối suốt lượt chạy (có job chờ /embed hàng chục giây). Kết nối này mở riêng,
    // ngoài pool: pool discovery cố ý chỉ 5 (docs/architecture/11 §3.3), lấy từ pool thì search mất một chỗ suốt lượt job.
    // fn vẫn dùng pool bình thường.
    const client = new pg.Client(this.db.$client.options);
    // Kết nối ngoài pool không có ai nghe sự kiện 'error': đứt kết nối khi đang chờ fn (Postgres restart) sẽ làm sập tiến trình.
    // Nuốt ở đây; câu unlock sau đó lỗi nên lượt job báo lỗi, Postgres tự trả khoá khi phiên đóng.
    client.on('error', () => {});
    await client.connect();
    try {
      const lock = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [name]);
      if (!lock.rows[0]?.ok) return null;
      try {
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [name]);
      }
    } finally {
      await client.end();
    }
  }

  async replacePosts(posts: RecommendPostRow[]): Promise<boolean> {
    // content tạm rỗng (reseed) thì không xoá sạch metadata: bỏ lượt.
    if (!posts.length) return false;
    await this.db.transaction(async (tx) => {
      await tx.delete(recommendPosts).where(notInArray(recommendPosts.postId, posts.map((p) => p.postId)));
      for (const part of chunks(posts)) {
        await tx
          .insert(recommendPosts)
          .values(part.map((p) => ({ ...p, syncedAt: new Date() })))
          .onConflictDoUpdate({
            target: recommendPosts.postId,
            set: {
              authorId: excluded('author_id'),
              postType: excluded('post_type'),
              tags: excluded('tags'),
              placeId: excluded('place_id'),
              isVerified: excluded('is_verified'),
              hasPlan: excluded('has_plan'),
              publishedAt: excluded('published_at'),
              syncedAt: excluded('synced_at'),
            },
          });
      }
    });
    return true;
  }

  async countPostInteractions(now: Date): Promise<InteractionCounts> {
    const since24h = new Date(now.getTime() - DAY_MS);
    const rows = await this.db
      .select({
        postId: recommendInteractions.targetId,
        kind: recommendInteractions.kind,
        d30: sql<number>`count(*)::int`,
        h24: sql<number>`(count(*) filter (where ${recommendInteractions.occurredAt} > ${since24h}))::int`,
      })
      .from(recommendInteractions)
      .where(
        and(
          eq(recommendInteractions.targetType, 'post'),
          eq(recommendInteractions.isRemoved, false),
          gt(recommendInteractions.occurredAt, daysBefore(now, 30)),
          lte(recommendInteractions.occurredAt, now),
        ),
      )
      .groupBy(recommendInteractions.targetId, recommendInteractions.kind);
    const counts: InteractionCounts = new Map();
    for (const r of rows) {
      if (!r.postId) continue;
      const entry = counts.get(r.postId) ?? { d30: {}, h24: {} };
      entry.d30[r.kind as Kind] = r.d30;
      if (r.h24) entry.h24[r.kind as Kind] = r.h24;
      counts.set(r.postId, entry);
    }
    return counts;
  }

  async listPostInteractionSamples(now: Date): Promise<Map<string, PostInteractionSample[]>> {
    const t = recommendInteractions;
    const reg = alias(recommendInteractions, 'reg');
    const postIdExpr = sql<string>`case when ${t.kind} = 'order_item' then ${t.detail}->>'sourcePostId' else ${t.targetId} end`;
    // Tuổi tài khoản theo ngày, chặn ở 7 vì từ 7 ngày trọng số đã là 1: mỗi bài chỉ còn vài dòng mỗi loại.
    const ageDaysExpr = sql<number | null>`case when ${reg.occurredAt} is null then null
      else least(7, greatest(0, floor(extract(epoch from (${now.toISOString()}::timestamptz - ${reg.occurredAt})) / 86400)))::int end`;
    const rows = await this.db
      .select({ postId: postIdExpr, kind: t.kind, actorAgeDays: ageDaysExpr, count: sql<number>`count(*)::int` })
      .from(t)
      .leftJoin(reg, and(eq(t.actorType, 'user'), eq(reg.actorType, 'user'), eq(reg.actorId, t.actorId), eq(reg.kind, 'registered')))
      .where(
        and(
          eq(recommendInteractions.isRemoved, false),
          gt(recommendInteractions.occurredAt, daysBefore(now, 30)),
          lte(recommendInteractions.occurredAt, now),
          or(
            and(eq(recommendInteractions.targetType, 'post'), isNotNull(recommendInteractions.targetId)),
            and(eq(recommendInteractions.kind, 'order_item'), sql`${recommendInteractions.detail}->>'sourcePostId' is not null`),
          ),
        ),
      )
      // Theo vị trí cột: biểu thức có tham số (now) viết lại trong GROUP BY sẽ thành tham số khác, Postgres không khớp.
      .groupBy(sql.raw('1, 2, 3'));

    const out = new Map<string, PostInteractionSample[]>();
    for (const r of rows) {
      if (!r.postId) continue;
      const list = out.get(r.postId) ?? [];
      list.push({ kind: r.kind as Kind, actorAgeDays: r.actorAgeDays, count: r.count });
      out.set(r.postId, list);
    }
    return out;
  }

  async replacePostScores(builderKey: string, scores: Array<{ postId: string; postType: string; score: number; features: Record<string, unknown> }>) {
    const { builder, version } = splitKey(builderKey);
    await this.db.transaction(async (tx) => {
      await tx.delete(recommendPostScores).where(and(eq(recommendPostScores.builder, builder), eq(recommendPostScores.version, version)));
      for (const part of chunks(scores)) {
        await tx.insert(recommendPostScores).values(part.map((s) => ({ builder, version, ...s })));
      }
    });
  }

  async listActiveUserIds(now: Date): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: recommendInteractions.actorId })
      .from(recommendInteractions)
      .where(
        and(
          eq(recommendInteractions.actorType, 'user'),
          gt(recommendInteractions.occurredAt, daysBefore(now, 30)),
          lte(recommendInteractions.occurredAt, now),
        ),
      );
    return rows.map((r) => r.id).sort();
  }

  async listDirtyUserIds(watermark: Date): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: recommendInteractions.actorId })
      .from(recommendInteractions)
      .where(and(eq(recommendInteractions.actorType, 'user'), gt(recommendInteractions.ingestedAt, watermark)));
    return rows.map((r) => r.id).sort();
  }

  async listUserRows(userIds: string[], now: Date): Promise<RawRow[]> {
    if (!userIds.length) return [];
    const t = recommendInteractions;
    // Trần mỗi người mỗi loại (row-limits.ts): bảng phình vì bot / stress test thì RAM của job và feed vẫn có trần.
    const ranked = this.db
      .select({
        actorType: t.actorType,
        actorId: t.actorId,
        kind: t.kind,
        refId: t.refId,
        targetType: t.targetType,
        targetId: t.targetId,
        value: t.value,
        isRemoved: t.isRemoved,
        detail: t.detail,
        occurredAt: t.occurredAt,
        rank: sql<number>`row_number() over (partition by ${t.actorId}, ${t.kind} order by ${t.occurredAt} desc, ${t.refId})`.as('rank'),
      })
      .from(t)
      .where(and(eq(t.actorType, 'user'), inArray(t.actorId, userIds), gt(t.occurredAt, daysBefore(now, 30)), lte(t.occurredAt, now)))
      .as('ranked');
    const rows = await this.db
      .select()
      .from(ranked)
      .where(sql`${ranked.rank} <= case when ${ranked.kind} in ${[...APPEND_ONLY_KINDS]} then ${APPEND_ONLY_KEEP}::int else ${OTHER_KIND_READ_CAP}::int end`);
    return rows.map((r) => ({
      actorType: r.actorType as RawRow['actorType'],
      actorId: r.actorId,
      kind: r.kind as Kind,
      refId: r.refId,
      targetType: r.targetType,
      targetId: r.targetId,
      value: r.value,
      isRemoved: r.isRemoved,
      detail: r.detail ?? null,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  async countProductBookings(now: Date): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ productId: recommendInteractions.targetId, n: sql<number>`count(*)::int` })
      .from(recommendInteractions)
      .where(
        and(
          eq(recommendInteractions.kind, 'order_item'),
          inArray(recommendInteractions.targetType, ['room', 'flight']),
          eq(recommendInteractions.isRemoved, false),
          gt(recommendInteractions.occurredAt, daysBefore(now, 30)),
          lte(recommendInteractions.occurredAt, now),
        ),
      )
      .groupBy(recommendInteractions.targetId);
    return new Map(rows.flatMap((r) => (r.productId ? [[r.productId, r.n] as const] : [])));
  }

  async replaceProductFeatures(builderKey: string, productType: ProductType, rows: ProductBuildOutput[]) {
    const { builder, version } = splitKey(builderKey);
    const t = recommendProductFeatures;
    await this.db.transaction(async (tx) => {
      await tx.delete(t).where(and(eq(t.builder, builder), eq(t.version, version)));
      for (const part of chunks(rows)) {
        await tx.insert(t).values(part.map((r) => ({ builder, version, productType, ...r })));
      }
    });
  }

  async listPlaceStyleCounts(): Promise<Array<{ placeId: string; style: string; hotels: number }>> {
    const t = recommendProductFeatures;
    const style = sql<string>`${t.features}->>'style'`;
    const rows = await this.db
      .select({ placeId: t.groupKey, style, hotels: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.builder, 'hotel_profile'), eq(t.productType, 'hotel'), sql`${t.features}->>'style' is not null`))
      .groupBy(t.groupKey, style);
    return rows.map((r) => ({ placeId: r.placeId, style: r.style, hotels: Number(r.hotels) }));
  }

  async findProductFeatures(builderKey: string, productIds: string[]) {
    if (!productIds.length) return new Map<string, { score: number; features: Record<string, unknown> }>();
    const { builder, version } = splitKey(builderKey);
    const t = recommendProductFeatures;
    const rows = await this.db
      .select({ productId: t.productId, score: t.score, features: t.features })
      .from(t)
      .where(and(eq(t.builder, builder), eq(t.version, version), inArray(t.productId, productIds)));
    return new Map(rows.map((r) => [r.productId, { score: r.score, features: r.features }]));
  }

  async upsertUserFeatures(builderKey: string, features: Array<{ userId: string; features: Record<string, unknown> }>) {
    const { builder, version } = splitKey(builderKey);
    for (const part of chunks(features)) {
      await this.db
        .insert(recommendUserFeatures)
        .values(part.map((f) => ({ builder, version, userId: f.userId, features: f.features, builtAt: new Date() })))
        .onConflictDoUpdate({
          target: [recommendUserFeatures.builder, recommendUserFeatures.version, recommendUserFeatures.userId],
          set: { features: excluded('features'), builtAt: excluded('built_at') },
        });
    }
  }

  async setJobState(name: string, state: { lastRunAt: Date; lastError: string | null; watermark?: Date }) {
    await this.db
      .insert(recommendJobState)
      .values({ name, ...state })
      .onConflictDoUpdate({ target: recommendJobState.name, set: state });
  }

  async getAdminStats(now: Date): Promise<RecommendAdminStats> {
    const since10m = new Date(now.getTime() - 10 * 60_000);
    const since24h = new Date(now.getTime() - DAY_MS);
    const [[interactions], [posts], [users], jobStates] = await Promise.all([
      this.db
        .select({
          last10m: sql<number>`(count(*) filter (where ${recommendInteractions.ingestedAt} > ${since10m}))::int`,
          last24h: sql<number>`count(*)::int`,
        })
        .from(recommendInteractions)
        .where(gt(recommendInteractions.ingestedAt, since24h)),
      this.db.select({ n: sql<number>`count(*)::int` }).from(recommendPosts),
      this.db.select({ n: sql<number>`count(distinct ${recommendUserFeatures.userId})::int` }).from(recommendUserFeatures),
      this.db
        .select({ name: recommendJobState.name, lastRunAt: recommendJobState.lastRunAt, lastError: recommendJobState.lastError })
        .from(recommendJobState)
        .orderBy(recommendJobState.name),
    ]);
    return {
      interactionsLast10m: interactions?.last10m ?? 0,
      interactionsLast24h: interactions?.last24h ?? 0,
      posts: posts?.n ?? 0,
      usersWithFeatures: users?.n ?? 0,
      jobStates,
    };
  }

  async listActiveAlgos() {
    return this.db
      .select({ name: recommendAlgos.name, postBuilder: recommendAlgos.postBuilder, userBuilder: recommendAlgos.userBuilder, ranker: recommendAlgos.ranker })
      .from(recommendAlgos)
      .where(eq(recommendAlgos.isActive, true));
  }

  async findUserFeatures(builderKey: string, userId: string) {
    const { builder, version } = splitKey(builderKey);
    const [row] = await this.db
      .select({ features: recommendUserFeatures.features })
      .from(recommendUserFeatures)
      .where(and(eq(recommendUserFeatures.builder, builder), eq(recommendUserFeatures.version, version), eq(recommendUserFeatures.userId, userId)));
    return row?.features ?? null;
  }

  async listInteractedPostIds(userId: string, now: Date): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: recommendInteractions.targetId })
      .from(recommendInteractions)
      .where(
        and(
          eq(recommendInteractions.actorType, 'user'),
          eq(recommendInteractions.actorId, userId),
          eq(recommendInteractions.targetType, 'post'),
          eq(recommendInteractions.isRemoved, false),
          lte(recommendInteractions.occurredAt, now),
        ),
      );
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  }

  async listOwnRecentPostIds(q: { userId: string; since: Date; until: Date; postType: string | null }): Promise<string[]> {
    const t = recommendInteractions;
    const rows = await this.db
      .select({ id: t.targetId })
      .from(t)
      .where(
        and(
          eq(t.actorType, 'user'),
          eq(t.actorId, q.userId),
          eq(t.kind, 'publish'),
          eq(t.isRemoved, false),
          gt(t.occurredAt, q.since),
          lte(t.occurredAt, q.until),
          q.postType ? sql`${t.detail}->>'postType' = ${q.postType}` : undefined,
        ),
      )
      .orderBy(desc(t.occurredAt));
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  }

  async findProductPlaces(productIds: string[]): Promise<Record<string, string>> {
    if (!productIds.length) return {};
    const t = recommendProductFeatures;
    const rows = await this.db
      .selectDistinct({ productId: t.productId, groupKey: t.groupKey })
      .from(t)
      .where(and(eq(t.productType, 'hotel'), inArray(t.productId, productIds)));
    return Object.fromEntries(rows.map((r) => [r.productId, r.groupKey]));
  }

  async findPostMetas(postIds: string[]): Promise<PostMeta[]> {
    if (!postIds.length) return [];
    const { postId, authorId, postType, tags, placeId, hasPlan } = recommendPosts;
    // hasPlan: mode has_plan lọc bài tự đăng (own) theo cờ này; thiếu thì mọi bài tự đăng bị loại.
    return this.db.select({ postId, authorId, postType, tags, placeId, hasPlan }).from(recommendPosts).where(inArray(recommendPosts.postId, postIds));
  }

  async findTextVectors(model: string, textHashes: string[]): Promise<Map<string, number[]>> {
    if (textHashes.length === 0) return new Map();
    const rows = await this.db
      .select({ textHash: recommendTextVectors.textHash, vector: recommendTextVectors.vector })
      .from(recommendTextVectors)
      .where(and(eq(recommendTextVectors.model, model), inArray(recommendTextVectors.textHash, textHashes)));
    return new Map(rows.map((r) => [r.textHash, r.vector]));
  }

  async insertTextVectors(model: string, rows: Array<{ textHash: string; vector: number[] }>): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(recommendTextVectors)
      .values(rows.map((r) => ({ model, ...r })))
      .onConflictDoNothing();
  }

  async findPostBins(builderKey: string, postIds: string[]): Promise<Map<string, Record<string, number>>> {
    if (!postIds.length) return new Map();
    const { builder, version } = splitKey(builderKey);
    const rows = await this.db
      .select({ postId: recommendPostScores.postId, bins: sql<Record<string, number> | null>`${recommendPostScores.features} -> 'bins'` })
      .from(recommendPostScores)
      .where(and(eq(recommendPostScores.builder, builder), eq(recommendPostScores.version, version), inArray(recommendPostScores.postId, postIds)));
    return new Map(rows.flatMap((r) => (r.bins ? [[r.postId, r.bins] as const] : [])));
  }

  async findPostScores(builderKey: string, postIds: string[]): Promise<Map<string, number>> {
    if (!postIds.length) return new Map();
    const { builder, version } = splitKey(builderKey);
    const rows = await this.db
      .select({ postId: recommendPostScores.postId, score: recommendPostScores.score })
      .from(recommendPostScores)
      .where(and(eq(recommendPostScores.builder, builder), eq(recommendPostScores.version, version), inArray(recommendPostScores.postId, postIds)));
    return new Map(rows.map((r) => [r.postId, Number(r.score)]));
  }

  listHotCandidates(q: CandidateQuery) {
    return this.candidates(q, 'hot', [desc(recommendPostScores.score), desc(recommendPosts.publishedAt), desc(recommendPosts.postId)]);
  }

  listCandidatesByIds(q: CandidateQuery, postIds: string[], source: CandidateSource) {
    if (!postIds.length) return Promise.resolve([]);
    return this.candidates({ ...q, limit: postIds.length }, source, [desc(recommendPosts.publishedAt), desc(recommendPosts.postId)], undefined, postIds);
  }

  listFreshCandidates(q: CandidateQuery & { hours: number }) {
    const since = new Date(q.now.getTime() - q.hours * 3_600_000);
    return this.candidates(q, 'fresh', [desc(recommendPosts.publishedAt), desc(recommendPosts.postId)], since);
  }

  listExplorePool(q: CandidateQuery & { days: number }) {
    return this.candidates(q, 'explore', [desc(recommendPosts.publishedAt), desc(recommendPosts.postId)], daysBefore(q.now, q.days));
  }

  /** hot: chỉ bài có điểm (inner join). fresh/explore: mọi bài trong cửa sổ, chưa có điểm thì 0. */
  private async candidates(q: CandidateQuery, source: CandidateSource, orderBy: SQL[], publishedAfter?: Date, onlyPostIds?: string[]): Promise<Candidate[]> {
    const { builder, version } = splitKey(q.postBuilder);
    const onScore = and(
      eq(recommendPostScores.postId, recommendPosts.postId),
      eq(recommendPostScores.builder, builder),
      eq(recommendPostScores.version, version),
    );
    // hot lọc post_type trên bảng điểm để dùng index (builder, version, post_type, score desc).
    const postTypeColumn = source === 'hot' ? recommendPostScores.postType : recommendPosts.postType;
    const where = and(
      q.postType ? eq(postTypeColumn, q.postType) : undefined,
      q.hasPlan ? eq(recommendPosts.hasPlan, true) : undefined,
      q.excludePostIds.length ? notInArray(recommendPosts.postId, q.excludePostIds) : undefined,
      lte(recommendPosts.publishedAt, q.now),
      publishedAfter ? gt(recommendPosts.publishedAt, publishedAfter) : undefined,
      onlyPostIds ? inArray(recommendPosts.postId, onlyPostIds) : undefined,
    );
    const select = {
      postId: recommendPosts.postId,
      authorId: recommendPosts.authorId,
      postType: recommendPosts.postType,
      tags: recommendPosts.tags,
      placeId: recommendPosts.placeId,
      score: sql<number>`coalesce(${recommendPostScores.score}, 0)`,
      postFeatures: sql<Record<string, unknown>>`coalesce(${recommendPostScores.features}, '{}'::jsonb)`,
    };
    const base = this.db.select(select).from(recommendPosts);
    const joined = source === 'hot' ? base.innerJoin(recommendPostScores, onScore) : base.leftJoin(recommendPostScores, onScore);
    const rows = await joined.where(where).orderBy(...orderBy).limit(q.limit);
    return rows.map((r) => ({ ...r, score: Number(r.score), source }));
  }

  async purgeExpired(now: Date, batchSize: number): Promise<number> {
    const t = recommendInteractions;
    const result = await this.db.execute<{ ok: number }>(sql`
      delete from ${t} where ctid in (
        select ctid from ${t} where
          (${t.isRemoved} and ${t.occurredAt} < ${daysBefore(now, RETENTION.removedDays)})
          or (${t.kind} in ${[...APPEND_ONLY_KINDS]} and ${t.occurredAt} < ${daysBefore(now, RETENTION.appendOnlyDays)})
          or ${t.occurredAt} < ${daysBefore(now, RETENTION.otherDays)}
        limit ${batchSize}
      ) returning 1 as ok`);
    return result.rows.length;
  }

  async purgeExcess(batchSize: number): Promise<number> {
    const t = recommendInteractions;
    const kinds = [...APPEND_ONLY_KINDS];
    // Chỉ xếp hạng nhóm (người, loại) vượt trần, không chạy hàm cửa sổ trên cả bảng.
    const result = await this.db.execute<{ ok: number }>(sql`
      delete from ${t} where ctid in (
        select ctid from (
          select ctid, row_number() over (partition by ${t.actorType}, ${t.actorId}, ${t.kind} order by ${t.occurredAt} desc, ${t.refId}) as rank
          from ${t}
          where ${t.kind} in ${kinds} and (${t.actorType}, ${t.actorId}, ${t.kind}) in (
            select ${t.actorType}, ${t.actorId}, ${t.kind} from ${t}
            where ${t.kind} in ${kinds}
            group by 1, 2, 3 having count(*) > ${APPEND_ONLY_KEEP}::int
          )
        ) ranked where rank > ${APPEND_ONLY_KEEP}::int
        limit ${batchSize}
      ) returning 1 as ok`);
    return result.rows.length;
  }
}
