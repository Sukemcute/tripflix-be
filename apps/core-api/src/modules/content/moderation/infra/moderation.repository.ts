import { and, asc, desc, eq, getTableColumns, gte, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  contentVersion,
  postEvidence,
  APPEAL_WINDOW_DAYS,
  EVIDENCE_RETENTION_DAYS,
} from '../domain/content-version.js';
import {
  comments,
  moderationActions,
  moderationCases,
  moderationAppeals,
  moderationProcessedEvents,
  moderationScans,
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
  mediaIds: string[];
  deleted: boolean;
}
export class ModerationRepository {
  constructor(private readonly getDb: () => Db) {}
  get db(): Db {
    return this.getDb();
  }

  async scan(eventId: string) {
    const [scan] = await this.db.select().from(moderationScans).where(eq(moderationScans.eventId, eventId));
    return scan;
  }
  async failedScans(limit: number, offset: number) {
    return this.db
      .select({
        eventId: moderationScans.eventId,
        targetType: moderationScans.targetType,
        targetId: moderationScans.targetId,
        status: moderationScans.status,
        attempts: moderationScans.attempts,
        updatedAt: moderationScans.updatedAt,
      })
      .from(moderationScans)
      .where(eq(moderationScans.status, 'failed'))
      .orderBy(asc(moderationScans.updatedAt), asc(moderationScans.eventId))
      .limit(limit + 1)
      .offset(offset);
  }

  async claimDeferredScans() {
    // Giữ bằng chứng của case/appeal chưa xử lý; xóa payload hết hạn của các lượt đã đóng.
    await this.db.execute(sql`UPDATE content.moderation_actions a SET evidence_snapshot = NULL
      WHERE a.evidence_snapshot IS NOT NULL AND a.created_at < now() - ${EVIDENCE_RETENTION_DAYS} * interval '1 day'
      AND NOT EXISTS (SELECT 1 FROM content.moderation_appeals p WHERE p.decision_id = a.id AND p.status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM content.moderation_cases c WHERE c.id = a.case_id AND c.status = 'pending')`);
    await this.db.execute(sql`UPDATE content.moderation_scans SET evidence = NULL
      WHERE evidence IS NOT NULL AND status IN ('passed', 'flagged', 'superseded')
      AND updated_at < now() - ${EVIDENCE_RETENTION_DAYS} * interval '1 day'`);
    const due = await this.db
      .select()
      .from(moderationScans)
      .where(and(eq(moderationScans.status, 'deferred'), sql`${moderationScans.nextAttemptAt} <= now()`))
      .orderBy(asc(moderationScans.nextAttemptAt))
      .limit(20)
      .for('update', { skipLocked: true });
    for (const scan of due)
      await this.db
        .update(moderationScans)
        .set({ nextAttemptAt: new Date(Date.now() + 300_000) })
        .where(eq(moderationScans.eventId, scan.eventId));
    return due;
  }

  async supersedeScan(eventId: string) {
    await this.db
      .update(moderationScans)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(and(eq(moderationScans.eventId, eventId), eq(moderationScans.status, 'deferred')));
  }

  async reportsByUser(reporterId: string, limit: number, offset: number) {
    return this.db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reasonCode: reports.reasonCode,
        createdAt: reports.createdAt,
        caseStatus: moderationCases.status,
      })
      .from(reports)
      .leftJoin(moderationCases, eq(reports.caseId, moderationCases.id))
      .where(eq(reports.reporterId, reporterId))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(limit + 1)
      .offset(offset);
  }

  /**
   * Số liệu tổng cho màn kiểm duyệt, đếm thẳng trong Postgres để không phụ thuộc trang FE tải về.
   * "Hàng chờ" dùng cùng điều kiện với queue view=pending để thẻ số khớp total của danh sách.
   */
  async stats(urgentSeverity: number) {
    const result = await this.db.execute<{
      pending_total: number;
      pending_urgent: number;
      pending_posts: number;
      pending_comments: number;
      oldest_pending_at: string | null;
      auto_hidden_24h: number;
      reports_24h: number;
      pending_appeals: number;
      failed_scans: number;
      deferred_scans: number;
    }>(sql`
      WITH pending AS (
        SELECT c.target_type, c.severity, c.created_at
        FROM ${moderationCases} c
        LEFT JOIN ${posts} p ON c.target_type = 'post' AND p.id = c.target_id
        LEFT JOIN ${comments} cm ON c.target_type = 'comment' AND cm.id = c.target_id
        WHERE c.status = 'pending'
          AND coalesce(p.status, cm.status, '') IN ('published', 'visible', 'hidden')
      )
      SELECT
        (SELECT count(*)::int FROM pending) AS pending_total,
        (SELECT count(*)::int FROM pending WHERE severity >= ${urgentSeverity}) AS pending_urgent,
        (SELECT count(*)::int FROM pending WHERE target_type = 'post') AS pending_posts,
        (SELECT count(*)::int FROM pending WHERE target_type = 'comment') AS pending_comments,
        (SELECT min(created_at) FROM pending) AS oldest_pending_at,
        (SELECT count(*)::int FROM ${moderationActions}
          WHERE action = 'auto_hide' AND created_at >= now() - interval '24 hours') AS auto_hidden_24h,
        (SELECT count(*)::int FROM ${reports}
          WHERE created_at >= now() - interval '24 hours') AS reports_24h,
        (SELECT count(*)::int FROM ${moderationAppeals} WHERE status = 'pending') AS pending_appeals,
        (SELECT count(*)::int FROM ${moderationScans} WHERE status = 'failed') AS failed_scans,
        (SELECT count(*)::int FROM ${moderationScans} WHERE status = 'deferred') AS deferred_scans
    `);
    const row = result.rows[0]!;
    const oldest = row.oldest_pending_at ? new Date(row.oldest_pending_at) : null;
    return {
      pendingTotal: Number(row.pending_total),
      pendingUrgent: Number(row.pending_urgent),
      pendingPosts: Number(row.pending_posts),
      pendingComments: Number(row.pending_comments),
      oldestPendingAt: oldest ? oldest.toISOString() : null,
      autoHidden24h: Number(row.auto_hidden_24h),
      reports24h: Number(row.reports_24h),
      pendingAppeals: Number(row.pending_appeals),
      failedScans: Number(row.failed_scans),
      deferredScans: Number(row.deferred_scans),
      urgentSeverity,
      generatedAt: new Date().toISOString(),
    };
  }

  async pendingAppeals(limit: number, offset: number) {
    return this.db
      .select({
        appeal: moderationAppeals,
        decision: moderationActions,
        targetText: sql<
          string | null
        >`case when ${moderationActions.targetType} = 'post' then concat_ws(E'\n', ${posts.title}, ${posts.body}) else ${comments.body} end`,
        targetStatus: sql<string | null>`coalesce(${posts.status}, ${comments.status})`,
      })
      .from(moderationAppeals)
      .innerJoin(moderationActions, eq(moderationAppeals.decisionId, moderationActions.id))
      .leftJoin(posts, and(eq(moderationActions.targetType, 'post'), eq(moderationActions.postId, posts.id)))
      .leftJoin(
        comments,
        and(eq(moderationActions.targetType, 'comment'), eq(moderationActions.commentId, comments.id)),
      )
      .where(eq(moderationAppeals.status, 'pending'))
      .orderBy(asc(moderationAppeals.createdAt), asc(moderationAppeals.id))
      .limit(limit + 1)
      .offset(offset);
  }

  async appealsByUser(authorId: string, limit: number, offset: number) {
    return this.db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.authorId, authorId))
      .orderBy(desc(moderationAppeals.createdAt), desc(moderationAppeals.id))
      .limit(limit + 1)
      .offset(offset);
  }

  async decisionsByUser(authorId: string, limit: number, offset: number) {
    const rows = await this.db
      .select({
        id: moderationActions.id,
        targetType: moderationActions.targetType,
        postId: moderationActions.postId,
        commentId: moderationActions.commentId,
        action: moderationActions.action,
        reasonCode: moderationActions.reasonCode,
        targetPreview: sql<string | null>`${moderationActions.evidenceSnapshot}->>'text'`,
        createdAt: moderationActions.createdAt,
        appealStatus: moderationAppeals.status,
        contentVersion: moderationActions.contentVersion,
        canAppeal: sql<boolean>`${moderationActions.action} IN ('hide', 'auto_hide', 'remove')
        AND ${moderationActions.createdAt} >= now() - ${APPEAL_WINDOW_DAYS} * interval '1 day'
        AND ${moderationAppeals.id} IS NULL
        AND coalesce(${posts.status}, ${comments.status}) IN ('hidden', 'removed')
        AND coalesce(${posts.deletedAt}, ${comments.deletedAt}) IS NULL
        AND NOT EXISTS (SELECT 1 FROM content.moderation_actions newer
          WHERE newer.target_type = ${moderationActions.targetType}
            AND newer.action <> 'dismiss'
            AND coalesce(newer.comment_id, newer.post_id) = coalesce(${moderationActions.commentId}, ${moderationActions.postId})
            AND (newer.created_at, newer.id) > (${moderationActions.createdAt}, ${moderationActions.id}))`,
      })
      .from(moderationActions)
      .leftJoin(posts, and(eq(moderationActions.targetType, 'post'), eq(moderationActions.postId, posts.id)))
      .leftJoin(
        comments,
        and(eq(moderationActions.targetType, 'comment'), eq(moderationActions.commentId, comments.id)),
      )
      .leftJoin(moderationAppeals, eq(moderationAppeals.decisionId, moderationActions.id))
      .where(or(eq(posts.authorId, authorId), eq(comments.authorId, authorId)))
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(limit + 1)
      .offset(offset);
    return Promise.all(
      rows.map(async ({ contentVersion: version, ...row }) => {
        const id = row.targetType === 'post' ? row.postId : row.commentId;
        const target = id && row.canAppeal ? await this.loadTarget(row.targetType, id) : null;
        return {
          ...row,
          canAppeal: Boolean(
            row.canAppeal && target && !target.deleted && (!version || version === target.version),
          ),
        };
      }),
    );
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
            version: contentVersion(postEvidence(post).text, post.coverMediaId, post.mediaIds),
            coverMediaId: post.coverMediaId,
            mediaIds: post.mediaIds,
            deleted: Boolean(post.deletedAt),
          }
        : null;
    }
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, targetId));
    const [parentPost] = comment
      ? await this.db
          .select({ deletedAt: posts.deletedAt, status: posts.status })
          .from(posts)
          .where(eq(posts.id, comment.postId))
      : [];
    return comment
      ? {
          targetType,
          targetId,
          postId: comment.postId,
          authorId: comment.authorId,
          text: comment.body,
          status: comment.status,
          version: contentVersion(comment.body, null),
          coverMediaId: null,
          mediaIds: [],
          deleted: Boolean(
            comment.deletedAt || !parentPost || parentPost.deletedAt || parentPost.status === 'deleted',
          ),
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
          eq(reports.contentVersion, target.version),
          gte(reports.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      );
    return row?.count ?? 0;
  }
  async queue(options: {
    status?: 'pending' | 'resolved';
    view?: 'pending' | 'reviewed' | 'hidden' | 'removed';
    targetType?: ModerationTarget;
    reasonCode?: string;
    source?: string;
    limit: number;
    offset: number;
  }) {
    const postJoin = and(eq(moderationCases.targetType, 'post'), eq(posts.id, moderationCases.targetId));
    const commentJoin = and(
      eq(moderationCases.targetType, 'comment'),
      eq(comments.id, moderationCases.targetId),
    );
    const visibility = sql`coalesce(${posts.status}, ${comments.status}, '')`;
    const conditions = [];
    if (options.view) {
      if (options.view !== 'pending') {
        conditions.push(sql`${moderationCases.id} IN (
          SELECT DISTINCT ON (${moderationCases.targetType}, ${moderationCases.targetId}) ${moderationCases.id}
          FROM ${moderationCases}
          ORDER BY ${moderationCases.targetType}, ${moderationCases.targetId},
            ${moderationCases.createdAt} DESC, ${moderationCases.id} DESC
        )`);
      }
      if (options.view === 'pending') {
        conditions.push(
          eq(moderationCases.status, 'pending'),
          sql`${visibility} IN ('published', 'visible', 'hidden')`,
        );
      } else if (options.view === 'reviewed') {
        conditions.push(
          eq(moderationCases.status, 'resolved'),
          sql`${visibility} IN ('published', 'visible', 'draft')`,
        );
      } else if (options.view === 'hidden') {
        conditions.push(sql`${visibility} = 'hidden'`);
      } else {
        conditions.push(sql`${visibility} = 'removed'`);
      }
    } else {
      conditions.push(eq(moderationCases.status, options.status ?? 'pending'));
    }
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
        .select({
          ...getTableColumns(moderationCases),
          targetPreview: sql<string | null>`left(coalesce(
            nullif(btrim(${posts.title}), ''),
            nullif(btrim(${posts.body}), ''),
            nullif(btrim(${comments.body}), '')
          ), 160)`,
        })
        .from(moderationCases)
        .leftJoin(posts, postJoin)
        .leftJoin(comments, commentJoin)
        .where(and(...conditions))
        .orderBy(desc(moderationCases.severity), asc(moderationCases.createdAt), asc(moderationCases.id))
        .limit(options.limit)
        .offset(options.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(moderationCases)
        .leftJoin(posts, postJoin)
        .leftJoin(comments, commentJoin)
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
        contentVersion: target.version,
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
          eq(reports.contentVersion, target.version),
        ),
      );
  }
}
