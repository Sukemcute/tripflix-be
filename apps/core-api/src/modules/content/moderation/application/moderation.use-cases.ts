import { ConflictException, NotFoundException, HttpException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  moderationActions,
  moderationAppeals,
  moderationCases,
  moderationScans,
  reports,
  type ModerationTarget,
} from '../../db/schema/index.js';
import { MediaFacade } from '../../media/media.facade.js';
import type { ContentOutbox } from '../../social/application/ports/content-outbox.port.js';
import { evaluateRules } from '../domain/rules.js';
import { evaluateSeverity, type AiVerdict, type SeverityConfig } from '../domain/severity.js';
import { ModerationRepository, type TargetSnapshot } from '../infra/moderation.repository.js';
import { ChangeVisibilityUseCase, type ChangeVisibilityCommand } from './change-visibility.use-case.js';
import type { ModerationAiPort } from './ports.js';
import { MODERATION_POLICY_VERSION, APPEAL_WINDOW_DAYS } from '../domain/content-version.js';

export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
export interface ScreeningConfig extends SeverityConfig {
  allowedDomains: string[];
}

export class SubmitAppealUseCase {
  constructor(private readonly repository: ModerationRepository) {}

  @Transactional('content')
  async execute(decisionId: string, authorId: string, reason: string) {
    const [decision] = await this.repository.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, decisionId));
    if (!decision || !['hide', 'auto_hide', 'remove'].includes(decision.action))
      throw new NotFoundException('Không tìm thấy quyết định có thể khiếu nại');
    if (Date.now() - decision.createdAt.getTime() > APPEAL_WINDOW_DAYS * 86_400_000)
      throw new ConflictException('Đã hết thời hạn khiếu nại 30 ngày');
    const targetId = decision.targetType === 'comment' ? decision.commentId : decision.postId;
    if (!targetId) throw new NotFoundException('Không tìm thấy nội dung');
    const target = await this.repository.loadTarget(decision.targetType, targetId);
    if (!target || target.authorId !== authorId) throw new NotFoundException('Không tìm thấy quyết định');
    await this.repository.lockPost(target.postId);
    const current = await this.repository.loadTarget(decision.targetType, targetId);
    const [latest] = await this.repository.db
      .select({ id: moderationActions.id })
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.targetType, decision.targetType),
          sql`${moderationActions.action} <> 'dismiss'`,
          decision.targetType === 'comment'
            ? eq(moderationActions.commentId, targetId)
            : eq(moderationActions.postId, targetId),
        ),
      )
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(1);
    if (
      !current ||
      current.deleted ||
      !['hidden', 'removed'].includes(current.status) ||
      latest?.id !== decision.id ||
      (decision.contentVersion && current.version !== decision.contentVersion)
    )
      throw new ConflictException('Quyết định không còn hiệu lực để khiếu nại');
    const [appeal] = await this.repository.db
      .insert(moderationAppeals)
      .values({ decisionId, authorId, reason })
      .onConflictDoNothing()
      .returning();
    if (!appeal) throw new ConflictException('Quyết định đã được khiếu nại');
    return appeal;
  }
}

export class DecideAppealUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly visibility: ChangeVisibilityUseCase,
    private readonly outbox: ContentOutbox,
  ) {}

  @Transactional('content')
  async execute(appealId: string, reviewerId: string, outcome: 'upheld' | 'overturned') {
    const [appeal] = await this.repository.db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.id, appealId))
      .for('update');
    if (!appeal) throw new NotFoundException('Không tìm thấy khiếu nại');
    if (appeal.status !== 'pending') throw new ConflictException('Khiếu nại đã được xử lý');
    const [decision] = await this.repository.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, appeal.decisionId));
    if (!decision) throw new NotFoundException('Không tìm thấy quyết định');
    if (decision.actorType === 'staff' && decision.moderatorId === reviewerId)
      throw new ConflictException('Không thể tự duyệt quyết định của mình');
    const targetId = decision.targetType === 'comment' ? decision.commentId : decision.postId;
    if (!targetId || !decision.postId) throw new ConflictException('Nội dung không còn tồn tại');
    await this.repository.lockPost(decision.postId);
    if (outcome === 'overturned') {
      if (!decision.contentVersion)
        throw new ConflictException('Chưa thể khôi phục tự động: quyết định thiếu phiên bản nội dung');
      const target = await this.repository.loadTarget(decision.targetType, targetId);
      const [latest] = await this.repository.db
        .select({ id: moderationActions.id })
        .from(moderationActions)
        .where(
          and(
            eq(moderationActions.targetType, decision.targetType),
            sql`${moderationActions.action} <> 'dismiss'`,
            decision.targetType === 'comment'
              ? eq(moderationActions.commentId, targetId)
              : eq(moderationActions.postId, targetId),
          ),
        )
        .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
        .limit(1);
      if (
        !target ||
        target.deleted ||
        !['hidden', 'removed'].includes(target.status) ||
        target.version !== decision.contentVersion ||
        latest?.id !== decision.id
      )
        throw new ConflictException('Nội dung hoặc quyết định đã thay đổi; cần xử lý thủ công');
      await this.visibility.execute({
        targetType: decision.targetType,
        targetId,
        action: 'restore',
        actorId: reviewerId,
        actorType: 'staff',
        reasonCode: decision.reasonCode,
      });
      if (decision.caseId)
        await this.repository.db
          .update(moderationCases)
          .set({
            status: 'resolved',
            resolution: 'restore',
            resolvedBy: reviewerId,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(moderationCases.id, decision.caseId), eq(moderationCases.status, 'pending')));
    }
    const [result] = await this.repository.db
      .update(moderationAppeals)
      .set({ status: outcome, reviewerId, resolvedAt: new Date() })
      .where(and(eq(moderationAppeals.id, appealId), eq(moderationAppeals.status, 'pending')))
      .returning();
    if (!result) throw new ConflictException('Khiếu nại đã được xử lý');
    await this.outbox.add({
      type: 'content.appeal.decided',
      userId: reviewerId,
      payload: { appealId: appeal.id, authorId: appeal.authorId, decisionId: decision.id, outcome },
    });
    return result;
  }
}

/** Chỉ pha ghi có transaction; lời gọi AI và lấy ảnh thực hiện trước lớp này. */
export class RecordScreeningUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly visibility: ChangeVisibilityUseCase,
    private readonly config: ScreeningConfig,
  ) {}

  @Transactional('content')
  async execute(eventId: string, snapshot: TargetSnapshot, ai: AiVerdict | null, occurredAt?: string) {
    await this.repository.lockPost(snapshot.postId);
    const previousScan = await this.repository.scan(eventId);
    if (previousScan && previousScan.status !== 'deferred') return;
    // AI failures must remain retryable by the stream consumer.
    if (ai !== null && !(await this.repository.acceptEvent(eventId))) return;
    const target = await this.repository.loadTarget(snapshot.targetType, snapshot.targetId);
    if (
      !target ||
      target.deleted ||
      target.version !== snapshot.version ||
      (!['published', 'visible'].includes(target.status) &&
        !(target.status === 'hidden' && (await this.repository.pending(target))?.isAutoHidden))
    )
      return;
    if (occurredAt && (await this.repository.hasStaffDecisionAfter(target, occurredAt))) return;
    const attempts = (previousScan?.attempts ?? 0) + 1;
    const scanStatus =
      ai === null ? (attempts >= 8 ? 'failed' : 'deferred') : ai.flagged ? 'flagged' : 'passed';
    const nextAttemptAt = new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** (attempts - 1)));
    const evidence = { text: target.text, coverMediaId: target.coverMediaId, mediaIds: target.mediaIds, ai };
    await this.repository.db
      .insert(moderationScans)
      .values({
        eventId,
        targetType: target.targetType,
        targetId: target.targetId,
        contentVersion: target.version,
        status: scanStatus,
        model: ai?.model ?? null,
        policyVersion: MODERATION_POLICY_VERSION,
        evidence,
        occurredAt: occurredAt ? new Date(occurredAt) : null,
        nextAttemptAt,
      })
      .onConflictDoUpdate({
        target: moderationScans.eventId,
        set: {
          contentVersion: target.version,
          status: scanStatus,
          model: ai?.model ?? null,
          policyVersion: MODERATION_POLICY_VERSION,
          evidence,
          nextAttemptAt,
          attempts: sql`${moderationScans.attempts} + 1`,
          updatedAt: new Date(),
        },
      });
    const rules = evaluateRules(target.text, this.config.allowedDomains);
    const reportCount = await this.repository.countRecentReports(target);
    const verdict = evaluateSeverity(rules, ai, reportCount, this.config);
    if (!verdict.suspicious) return;
    const item = await this.repository.upsertCase(target, {
      sources: [...(rules.length ? ['rule'] : []), ...(ai?.flagged ? ['ai'] : [])],
      severity: verdict.severity,
      reportCount,
      flags: {
        rules,
        ai,
        aiUnavailable: ai === null,
        reasonCode: verdict.autoHideReason ?? rules[0]?.category ?? 'OTHER',
      },
    });
    if (verdict.shouldAutoHide && target.status !== 'hidden') {
      await this.visibility.execute({
        targetType: target.targetType,
        targetId: target.targetId,
        action: 'hide',
        actorId: SYSTEM_ACTOR_ID,
        actorType: 'system',
        reasonCode: verdict.autoHideReason ?? 'OTHER',
        caseId: item.id,
      });
      await this.repository.db
        .update(moderationCases)
        .set({ isAutoHidden: true })
        .where(eq(moderationCases.id, item.id));
    }
  }
}
export class ScreenContentUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly ai: ModerationAiPort,
    private readonly record: RecordScreeningUseCase,
    private readonly media: MediaFacade,
  ) {}
  async execute(eventId: string, targetType: ModerationTarget, targetId: string, occurredAt?: string) {
    const target = await this.repository.loadTarget(targetType, targetId);
    const scan = await this.repository.scan(eventId);
    if (scan && scan.status !== 'deferred') return;
    if (
      !target ||
      target.deleted ||
      (scan && target.version !== scan.contentVersion) ||
      (occurredAt && target && (await this.repository.hasStaffDecisionAfter(target, occurredAt)))
    ) {
      await this.repository.supersedeScan(eventId);
      return;
    }
    if (
      !['published', 'visible'].includes(target.status) &&
      !(target.status === 'hidden' && (await this.repository.pending(target))?.isAutoHidden)
    ) {
      await this.repository.supersedeScan(eventId);
      return;
    }
    const playback = target.coverMediaId ? await this.media.getPlayback([target.coverMediaId]) : {};
    const poster = target.coverMediaId ? playback[target.coverMediaId]?.posters.w540 : undefined;
    const result = await this.ai.moderate([
      { id: `${targetType}:${targetId}`, text: target.text, imageUrls: poster ? [poster] : [] },
    ]);
    const verdict = result?.[0] ?? null;
    await this.record.execute(eventId, target, verdict, occurredAt);
    if (!verdict) throw new Error('AI moderation unavailable; retry screening');
  }
}

export class SubmitReportUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly visibility: ChangeVisibilityUseCase,
    private readonly outbox: ContentOutbox,
    private readonly config: ScreeningConfig,
  ) {}
  @Transactional('content')
  async execute(input: {
    targetType: ModerationTarget;
    targetId: string;
    reporterId: string;
    reasonCode: string;
    reasonDetail?: string;
  }) {
    const target = await this.repository.loadTarget(input.targetType, input.targetId);
    if (!target) throw new NotFoundException('Không tìm thấy nội dung');
    const post = await this.repository.lockPost(target.postId);
    const current = await this.repository.loadTarget(input.targetType, input.targetId);
    if (!current) throw new NotFoundException('Không tìm thấy nội dung');
    const [existing] = await this.repository.db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.reporterId, input.reporterId),
          eq(reports.contentVersion, current.version),
        ),
      );
    if (existing) return existing;
    if (
      !current ||
      current.deleted ||
      !['published', 'visible'].includes(current.status) ||
      !post ||
      post.status !== 'published' ||
      post.visibility !== 'public' ||
      post.deletedAt
    )
      throw new NotFoundException('Nội dung không còn hiển thị');
    await this.repository.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('moderation.report'), hashtext(${input.reporterId}))`,
    );
    const [recent] = await this.repository.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(eq(reports.reporterId, input.reporterId), sql`${reports.createdAt} >= now() - interval '1 hour'`),
      );
    if ((recent?.count ?? 0) >= 20)
      throw new HttpException('Bạn đã gửi nhiều báo cáo, vui lòng thử lại sau', 429);
    const report = await this.repository.report(
      current,
      input.reporterId,
      input.reasonCode,
      input.reasonDetail,
    );
    const count = await this.repository.countRecentReports(current);
    const verdict = evaluateSeverity([], null, count, this.config);
    const item = await this.repository.upsertCase(current, {
      sources: ['report'],
      severity: verdict.severity,
      flags: {},
      reportCount: count,
    });
    await this.repository.attachReports(current, item.id);
    if (verdict.shouldAutoHide) {
      await this.visibility.execute({
        targetType: current.targetType,
        targetId: current.targetId,
        action: 'hide',
        actorId: SYSTEM_ACTOR_ID,
        actorType: 'system',
        reasonCode: input.reasonCode,
        caseId: item.id,
      });
      await this.repository.db
        .update(moderationCases)
        .set({ isAutoHidden: true })
        .where(eq(moderationCases.id, item.id));
    }
    if (report)
      await this.outbox.add({
        type: 'content.report.created',
        userId: input.reporterId,
        payload: {
          reportId: report.id,
          caseId: item.id,
          targetType: current.targetType,
          targetId: current.targetId,
          postId: current.postId,
          reasonCode: input.reasonCode,
        },
      });
    return { ...report!, caseId: item.id };
  }
}

export class DecideCaseUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly visibility: ChangeVisibilityUseCase,
  ) {}
  @Transactional('content')
  async execute(
    caseId: string,
    input: Omit<ChangeVisibilityCommand, 'targetType' | 'targetId' | 'caseId' | 'actorType'>,
  ) {
    const item = await this.repository.findCase(caseId);
    if (!item) throw new NotFoundException('Không tìm thấy hồ sơ kiểm duyệt');
    await this.repository.lockPost(item.postId);
    const updated = await this.repository.db
      .update(moderationCases)
      .set({
        status: 'resolved',
        resolution: input.action,
        resolvedBy: input.actorId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(moderationCases.id, caseId), eq(moderationCases.status, 'pending')))
      .returning();
    if (!updated.length) throw new ConflictException('Hồ sơ đã được xử lý');
    const result = await this.visibility.execute({
      ...input,
      targetType: item.targetType,
      targetId: item.targetId,
      caseId,
      actorType: 'staff',
    });
    return { ...updated[0]!, ...result };
  }
}
