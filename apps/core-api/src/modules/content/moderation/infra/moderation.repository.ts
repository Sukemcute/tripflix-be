import { and, asc, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  comments,
  moderationActions,
  moderationCases,
  moderationProcessedEvents,
  posts,
  reports,
  type ModerationCaseRecord,
  type ModerationTarget,
} from '../../db/schema/index.js';

export interface TargetSnapshot {
  targetType: ModerationTarget;
  targetId: string;
  postId: string;
  authorId: string;
  text: string;
  status: string;
  version: string;
  coverMediaId: string | null;
  deleted: boolean;
}
export class ModerationRepository {
  constructor(private readonly getDb: () => Db) {}
  get db(): Db {
    return this.getDb();
  }

  async hasStaffDecisionAfter(target: TargetSnapshot, occurredAt: string): Promise<boolean> {
    let parentId: string | null = null;
    if (target.targetType === 'comment') {
      const [comment] = await this.db
        .select({ parentId: comments.parentCommentId })
        .from(comments)
        .where(eq(comments.id, target.targetId));
      parentId = comment?.parentId ?? null;
    }
    const [decision] = await this.db
      .select({ id: moderationActions.id })
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.actorType, 'staff'),
          sql`${moderationActions.createdAt} > ${new Date(occurredAt)}`,
          target.targetType === 'post'
            ? and(eq(moderationActions.targetType, 'post'), eq(moderationActions.postId, target.targetId))
            : or(
                eq(moderationActions.commentId, target.targetId),
                ...(parentId ? [eq(moderationActions.commentId, parentId)] : []),
              ),
        ),
      )
      .limit(1);
    return Boolean(decision);
  }

  async loadTarget(targetType: ModerationTarget, targetId: string): Promise<TargetSnapshot | null> {
    if (targetType === 'post') {
      const [post] = await this.db.select().from(posts).where(eq(posts.id, targetId));
      return post
        ? {
            targetType,
            targetId,
            postId: post.id,
            authorId: post.authorId,
            text: [post.title, post.body, ...post.hashtags].join('\n'),
            status: post.status,
            version: post.updatedAt.toISOString(),
            coverMediaId: post.coverMediaId,
            deleted: Boolean(post.deletedAt),
          }
        : null;
    }
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, targetId));
    return comment
      ? {
          targetType,
          targetId,
          postId: comment.postId,
          authorId: comment.authorId,
          text: comment.body,
          status: comment.status,
          version: comment.updatedAt.toISOString(),
          coverMediaId: null,
          deleted: Boolean(comment.deletedAt),
        }
      : null;
  }
  async lockPost(postId: string) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, postId)).for('update');
    return post;
  }
  async acceptEvent(eventId: string): Promise<boolean> {
    const rows = await this.db
      .insert(moderationProcessedEvents)
      .values({ consumerGroup: 'core-moderation', eventId })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }
  async pending(target: TargetSnapshot) {
    const [row] = await this.db
      .select()
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.targetType, target.targetType),
          eq(moderationCases.targetId, target.targetId),
          eq(moderationCases.status, 'pending'),
        ),
      );
    return row;
  }
  async upsertCase(
    target: TargetSnapshot,
    patch: { sources: string[]; severity: number; flags: Record<string, unknown>; reportCount: number },
  ) {
    const current = await this.pending(target);
    if (current) {
      const [updated] = await this.db
        .update(moderationCases)
        .set({
          ...patch,
          sources: [...new Set([...current.sources, ...patch.sources])],
          flags: { ...current.flags, ...patch.flags },
          severity: Math.max(current.severity, patch.severity),
          updatedAt: new Date(),
        })
        .where(eq(moderationCases.id, current.id))
        .returning();
      return updated!;
    }
    const [created] = await this.db
      .insert(moderationCases)
      .values({
        targetType: target.targetType,
        targetId: target.targetId,
        postId: target.postId,
        authorId: target.authorId,
        ...patch,
      })
      .returning();
    return created!;
  }
  async findCase(id: string) {
    const [row] = await this.db.select().from(moderationCases).where(eq(moderationCases.id, id));
    return row;
  }
  async countRecentReports(target: TargetSnapshot): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(
          eq(reports.targetType, target.targetType),
          eq(reports.targetId, target.targetId),
          gte(reports.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      );
    return row?.count ?? 0;
  }
  async queue(options: {
    status?: 'pending' | 'resolved';
    targetType?: ModerationTarget;
    reasonCode?: string;
    source?: string;
    limit: number;
    offset: number;
  }) {
    const conditions = [eq(moderationCases.status, options.status ?? 'pending')];
    if (options.targetType) conditions.push(eq(moderationCases.targetType, options.targetType));
    if (options.source)
      conditions.push(sql`${moderationCases.sources} @> ${JSON.stringify([options.source])}::jsonb`);
    if (options.reasonCode)
      conditions.push(sql`(
      ${moderationCases.flags}->>'reasonCode' = ${options.reasonCode}
      OR EXISTS (SELECT 1 FROM ${reports} WHERE ${reports.caseId} = ${moderationCases.id} AND ${reports.reasonCode} = ${options.reasonCode})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${moderationCases.flags}->'rules', '[]'::jsonb)) AS rule WHERE rule->>'category' = ${options.reasonCode})
    )`);
    const [items, count] = await Promise.all([
      this.db
        .select()
        .from(moderationCases)
        .where(and(...conditions))
        .orderBy(desc(moderationCases.severity), asc(moderationCases.createdAt), asc(moderationCases.id))
        .limit(options.limit)
        .offset(options.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(moderationCases)
        .where(and(...conditions)),
    ]);
    return { items, total: count[0]?.total ?? 0 };
  }
  async log(options: {
    targetId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }) {
    const conditions = [];
    if (options.targetId)
      conditions.push(
        or(eq(moderationActions.postId, options.targetId), eq(moderationActions.commentId, options.targetId)),
      );
    if (options.actorId) conditions.push(eq(moderationActions.moderatorId, options.actorId));
    if (options.from) conditions.push(gte(moderationActions.createdAt, options.from));
    if (options.to) conditions.push(sql`${moderationActions.createdAt} <= ${options.to}`);
    return this.db
      .select()
      .from(moderationActions)
      .where(and(...conditions))
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(options.limit)
      .offset(options.offset);
  }
  async detail(item: ModerationCaseRecord) {
    const [target, reportItems, actions] = await Promise.all([
      this.loadTarget(item.targetType, item.targetId),
      this.db
        .select()
        .from(reports)
        .where(and(eq(reports.targetType, item.targetType), eq(reports.targetId, item.targetId)))
        .orderBy(desc(reports.createdAt)),
      this.log({ targetId: item.targetId, limit: 100, offset: 0 }),
    ]);
    return { ...item, target, reports: reportItems, actions };
  }
  async report(target: TargetSnapshot, reporterId: string, reasonCode: string, reasonDetail?: string) {
    const [row] = await this.db
      .insert(reports)
      .values({
        targetType: target.targetType,
        targetId: target.targetId,
        reporterId,
        reasonCode,
        reasonDetail,
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }
  async attachReports(target: TargetSnapshot, caseId: string) {
    await this.db
      .update(reports)
      .set({ caseId })
      .where(
        and(
          eq(reports.targetType, target.targetType),
          eq(reports.targetId, target.targetId),
          isNull(reports.caseId),
        ),
      );
  }
}
