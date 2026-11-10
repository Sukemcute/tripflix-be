import { ConflictException, NotFoundException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { and, eq } from 'drizzle-orm';
import { moderationCases, reports, type ModerationTarget } from '../../db/schema/index.js';
import { MediaFacade } from '../../media/media.facade.js';
import type { ContentOutbox } from '../../social/application/ports/content-outbox.port.js';
import { evaluateRules } from '../domain/rules.js';
import { evaluateSeverity, type AiVerdict, type SeverityConfig } from '../domain/severity.js';
import { ModerationRepository, type TargetSnapshot } from '../infra/moderation.repository.js';
import { ChangeVisibilityUseCase, type ChangeVisibilityCommand } from './change-visibility.use-case.js';
import type { ModerationAiPort } from './ports.js';

export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
export interface ScreeningConfig extends SeverityConfig {
  allowedDomains: string[];
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
    if (!(await this.repository.acceptEvent(eventId))) return;
    const target = await this.repository.loadTarget(snapshot.targetType, snapshot.targetId);
    if (
      !target ||
      target.deleted ||
      target.version !== snapshot.version ||
      !['published', 'visible'].includes(target.status)
    )
      return;
    if (occurredAt && (await this.repository.hasStaffDecisionAfter(target, occurredAt))) return;
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
        reasonCode: rules.some((hit) => hit.code === 'SCAM_PATTERN')
          ? 'SCAM'
          : (rules[0]?.category ?? 'OTHER'),
      },
    });
    if (verdict.shouldAutoHide) {
      await this.visibility.execute({
        targetType: target.targetType,
        targetId: target.targetId,
        action: 'hide',
        actorId: SYSTEM_ACTOR_ID,
        actorType: 'system',
        reasonCode: rules.some((hit) => hit.code === 'SCAM_PATTERN') ? 'SCAM' : 'OTHER',
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
    if (!target || target.deleted || !['published', 'visible'].includes(target.status)) return;
    const playback = target.coverMediaId ? await this.media.getPlayback([target.coverMediaId]) : {};
    const poster = target.coverMediaId ? playback[target.coverMediaId]?.posters.w540 : undefined;
    const result = await this.ai.moderate([
      { id: `${targetType}:${targetId}`, text: target.text, imageUrls: poster ? [poster] : [] },
    ]);
    await this.record.execute(eventId, target, result?.[0] ?? null, occurredAt);
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
    const [existing] = await this.repository.db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.reporterId, input.reporterId),
        ),
      );
    if (existing) return existing;
    const current = await this.repository.loadTarget(input.targetType, input.targetId);
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
