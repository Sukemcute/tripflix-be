import type { Db } from '@tripflix/db';
import { and, desc, eq, gt, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  recommendAlgos,
  recommendInteractions,
  recommendJobState,
  recommendPostScores,
  recommendPosts,
  recommendUserFeatures,
} from '../../db/schema/index.js';
import type { CandidateQuery, InteractionCounts, RecommendPostRow, RecommendStore } from '../application/ports.js';
import { splitKey, type Candidate, type CandidateSource, type Kind, type PostMeta, type RawRow } from '../domain/contracts.js';
import type { OrderCancellation } from '../domain/ingest/to-raw-rows.js';

const CHUNK = 1000;
const DAY_MS = 86_400_000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);
const chunks = <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

/** Hạn lưu bảng thô (đề xuất mục 4). Dòng thêm mới (ref = eventId) giữ ngắn hơn dòng trạng thái. */
const RETENTION = { removedDays: 7, appendOnlyDays: 90, otherDays: 180 };
const APPEND_ONLY_KINDS = ['share', 'search', 'stays_search', 'view', 'flight_search'];

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export class DrizzleRecommendStore implements RecommendStore {
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
    // Khoá theo phiên cần giữ đúng một kết nối suốt lượt chạy; fn vẫn dùng pool bình thường.
    const client = await this.db.$client.connect();
    try {
      const lock = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [name]);
      if (!lock.rows[0]?.ok) return null;
      try {
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [name]);
      }
    } finally {
      client.release();
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
    const rows = await this.db
      .select()
      .from(recommendInteractions)
      .where(
        and(
          eq(recommendInteractions.actorType, 'user'),
          inArray(recommendInteractions.actorId, userIds),
          gt(recommendInteractions.occurredAt, daysBefore(now, 30)),
          lte(recommendInteractions.occurredAt, now),
        ),
      );
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

  async findPostMetas(postIds: string[]): Promise<PostMeta[]> {
    if (!postIds.length) return [];
    const { postId, authorId, postType, tags, placeId } = recommendPosts;
    return this.db.select({ postId, authorId, postType, tags, placeId }).from(recommendPosts).where(inArray(recommendPosts.postId, postIds));
  }

  listHotCandidates(q: CandidateQuery) {
    return this.candidates(q, 'hot', [desc(recommendPostScores.score), desc(recommendPosts.publishedAt), desc(recommendPosts.postId)]);
  }

  listFreshCandidates(q: CandidateQuery & { hours: number }) {
    const since = new Date(q.now.getTime() - q.hours * 3_600_000);
    return this.candidates(q, 'fresh', [desc(recommendPosts.publishedAt), desc(recommendPosts.postId)], since);
  }

  listExplorePool(q: CandidateQuery & { days: number }) {
    return this.candidates(q, 'explore', [desc(recommendPosts.publishedAt), desc(recommendPosts.postId)], daysBefore(q.now, q.days));
  }

  /** hot: chỉ bài có điểm (inner join). fresh/explore: mọi bài trong cửa sổ, chưa có điểm thì 0. */
  private async candidates(q: CandidateQuery, source: CandidateSource, orderBy: SQL[], publishedAfter?: Date): Promise<Candidate[]> {
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
      q.excludePostIds.length ? notInArray(recommendPosts.postId, q.excludePostIds) : undefined,
      lte(recommendPosts.publishedAt, q.now),
      publishedAfter ? gt(recommendPosts.publishedAt, publishedAfter) : undefined,
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
          or (${t.kind} in ${APPEND_ONLY_KINDS} and ${t.occurredAt} < ${daysBefore(now, RETENTION.appendOnlyDays)})
          or ${t.occurredAt} < ${daysBefore(now, RETENTION.otherDays)}
        limit ${batchSize}
      ) returning 1 as ok`);
    return result.rows.length;
  }
}
