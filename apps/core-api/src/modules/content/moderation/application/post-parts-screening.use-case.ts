import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { moderationParts, moderationScans, posts, type PartVerdict } from '../../db/schema/index.js';
import { MediaFacade } from '../../media/media.facade.js';
import type { ContentOutbox } from '../../social/application/ports/content-outbox.port.js';
import { MODERATION_POLICY_VERSION } from '../domain/content-version.js';
import { ModerationRepository, type TargetSnapshot } from '../infra/moderation.repository.js';
import type { ModerationAiPort, ModerationPartInput } from './ports.js';
import type { RecordScreeningUseCase } from './moderation.use-cases.js';

const POLICY = `${MODERATION_POLICY_VERSION}:parts-v1-review-images`;
type Part = typeof moderationParts.$inferSelect;
type Input = {
  key: string;
  kind: 'caption' | 'image';
  assetId: string | null;
  hash: string;
  text?: string;
  url?: string;
  mediaKind?: 'video' | 'image';
  state: 'pending' | 'waiting' | 'failed' | 'not_applicable';
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only claim/complete hold DB locks. All provider calls happen between these transactions. */
export class PostPartsScreeningUseCase {
  private readonly logger = new Logger('PostPartsScreening');
  constructor(
    private readonly repository: ModerationRepository,
    private readonly media: MediaFacade,
    private readonly ai: ModerationAiPort,
    private readonly record: RecordScreeningUseCase,
    private readonly outbox: ContentOutbox,
  ) {}

  private async inputs(target: TargetSnapshot, lock = false): Promise<Input[]> {
    const ids = [
      ...new Set([
        ...(target.coverMediaId ? [target.coverMediaId] : []),
        ...target.mediaIds,
        ...(target.posterMediaId ? [target.posterMediaId] : []),
      ]),
    ];
    const assets = await this.media.getModerationInputs(ids, lock);
    return [
      {
        key: 'caption',
        kind: 'caption',
        assetId: null,
        hash: hash(target.text),
        text: target.text,
        state: target.text.trim() ? 'pending' : 'not_applicable',
      },
      ...ids.map((id): Input => {
        const asset = assets.find((a) => a.id === id);
        return {
          key: `image:${id}`,
          kind: 'image',
          assetId: id,
          hash: asset?.revision ?? 'missing',
          ...(asset?.url ? { url: asset.url } : {}),
          ...(asset ? { mediaKind: asset.kind } : {}),
          state: asset?.status === 'failed' ? 'failed' : asset?.url ? 'pending' : 'waiting',
        };
      }),
    ];
  }

  private async eligible(postId: string, occurredAt?: string) {
    const t = await this.repository.loadTarget('post', postId);
    if (!t || t.deleted || !['published', 'held', 'hidden'].includes(t.status)) return null;
    if (t.status === 'hidden' && !(await this.repository.pending(t))?.isAutoHidden) return null;
    if (t.status !== 'held' && (await this.repository.hasHeldRelease(t))) return null;
    if (occurredAt && (await this.repository.hasStaffDecisionAfter(t, occurredAt))) return null;
    return t;
  }

  @Transactional('content')
  async prepare(postId: string, occurredAt?: string) {
    await this.repository.lockPost(postId);
    const target = await this.eligible(postId, occurredAt);
    if (!target) {
      await this.repository.db
        .update(moderationScans)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(
          and(
            eq(moderationScans.targetType, 'post'),
            eq(moderationScans.targetId, postId),
            eq(moderationScans.status, 'deferred'),
          ),
        );
      await this.repository.db
        .update(moderationParts)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(
          and(
            eq(moderationParts.postId, postId),
            inArray(moderationParts.status, ['pending', 'checking', 'waiting', 'deferred']),
          ),
        );
      return null;
    }
    const inputs = await this.inputs(target, true);
    const existing = await this.repository.db
      .select()
      .from(moderationParts)
      .where(and(eq(moderationParts.postId, postId), ne(moderationParts.status, 'superseded')));
    for (const old of existing) {
      if (
        old.contentVersion !== target.version ||
        old.policyVersion !== POLICY ||
        !inputs.some((i) => i.key === old.partKey && i.hash === old.inputHash)
      ) {
        if (old.status !== 'superseded')
          await this.repository.db
            .update(moderationParts)
            .set({ status: 'superseded', leaseId: null, leaseExpiresAt: null, updatedAt: new Date() })
            .where(eq(moderationParts.id, old.id));
        await this.repository.supersedeScan(old.id);
      }
    }
    for (const input of inputs)
      await this.repository.db
        .insert(moderationParts)
        .values({
          postId,
          contentVersion: target.version,
          partKey: input.key,
          kind: input.kind,
          assetId: input.assetId,
          inputHash: input.hash,
          policyVersion: POLICY,
          status: input.state,
          errorCode:
            input.state === 'failed' ? 'media_failed' : input.state === 'waiting' ? 'media_not_ready' : null,
          nextAttemptAt: new Date(Date.now() + (input.state === 'waiting' ? 30_000 : 0)),
        })
        .onConflictDoNothing();
    await this.repository.db
      .update(moderationParts)
      .set({ nextAttemptAt: new Date(Date.now() + 30_000) })
      .where(
        and(
          eq(moderationParts.postId, postId),
          eq(moderationParts.contentVersion, target.version),
          eq(moderationParts.status, 'waiting'),
        ),
      );
    return {
      target,
      inputs,
      parts: await this.repository.db
        .select()
        .from(moderationParts)
        .where(
          and(
            eq(moderationParts.postId, postId),
            eq(moderationParts.contentVersion, target.version),
            eq(moderationParts.policyVersion, POLICY),
            ne(moderationParts.status, 'superseded'),
          ),
        )
        .orderBy(asc(moderationParts.partKey)),
    };
  }

  @Transactional('content')
  async claim(part: Part, occurredAt?: string) {
    await this.repository.lockPost(part.postId);
    const target = await this.eligible(part.postId, occurredAt);
    if (!target || target.version !== part.contentVersion) return null;
    const input = (await this.inputs(target, true)).find(
      (i) => i.key === part.partKey && i.hash === part.inputHash,
    );
    if (!input || input.state !== 'pending') return null;
    const [row] = await this.repository.db
      .select()
      .from(moderationParts)
      .where(eq(moderationParts.id, part.id))
      .for('update');
    if (row && (await this.repository.hasStaffDecisionAfter(target, row.createdAt.toISOString()))) {
      await this.repository.db
        .update(moderationParts)
        .set({ status: 'superseded', leaseId: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(eq(moderationParts.id, row.id));
      await this.repository.supersedeScan(row.id);
      return null;
    }
    if (
      row?.status === 'checking' &&
      row.attempts >= 8 &&
      (row.leaseExpiresAt?.getTime() ?? 0) <= Date.now()
    ) {
      await this.repository.db
        .update(moderationParts)
        .set({
          status: 'failed',
          errorCode: 'worker_interrupted',
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(moderationParts.id, row.id));
      await this.repository.db
        .update(moderationScans)
        .set({ status: 'failed', attempts: 8, updatedAt: new Date() })
        .where(and(eq(moderationScans.eventId, row.id), eq(moderationScans.status, 'deferred')));
      return null;
    }
    if (
      !row ||
      row.attempts >= 8 ||
      !['pending', 'deferred', 'checking'].includes(row.status) ||
      (row.status === 'checking'
        ? (row.leaseExpiresAt?.getTime() ?? 0) > Date.now()
        : row.nextAttemptAt.getTime() > Date.now())
    )
      return null;
    const leaseId = randomUUID();
    const [claimed] = await this.repository.db
      .update(moderationParts)
      .set({
        status: 'checking',
        attempts: row.attempts + 1,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        nextAttemptAt: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      })
      .where(eq(moderationParts.id, row.id))
      .returning();
    return { part: claimed!, target, input };
  }

  @Transactional('content')
  async complete(
    claim: { part: Part; target: TargetSnapshot; input: Input },
    verdict: PartVerdict | null,
    startedAt: string,
  ) {
    const { part } = claim;
    await this.repository.lockPost(part.postId);
    const target = await this.eligible(part.postId, startedAt);
    const inputs = target ? await this.inputs(target, true) : [];
    const [current] = await this.repository.db
      .select()
      .from(moderationParts)
      .where(eq(moderationParts.id, part.id))
      .for('update');
    if (!current || current.status !== 'checking' || current.leaseId !== part.leaseId) return;
    if (
      !target ||
      target.version !== part.contentVersion ||
      !inputs.some((i) => i.key === part.partKey && i.hash === part.inputHash)
    ) {
      await this.repository.db
        .update(moderationParts)
        .set({ status: 'superseded', leaseId: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(eq(moderationParts.id, part.id));
      return;
    }
    const failed = !verdict || verdict.status === 'error';
    await this.repository.db
      .update(moderationParts)
      .set({
        status: failed
          ? part.attempts >= 8
            ? 'failed'
            : 'deferred'
          : verdict.status === 'flagged'
            ? 'flagged'
            : 'passed',
        verdict,
        errorCode: failed ? (verdict?.errorCode ?? 'ai_unavailable') : null,
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** (part.attempts - 1))),
        updatedAt: new Date(),
      })
      .where(eq(moderationParts.id, part.id));
    if (part.kind === 'caption') {
      await this.record.execute(
        part.id,
        target,
        failed
          ? null
          : {
              id: part.id,
              flagged: verdict.status === 'flagged',
              categories: verdict.categories,
              scores: verdict.scores,
              model: verdict.model!,
            },
        startedAt,
      );
    } else if (verdict?.status === 'flagged') {
      const previous = await this.repository.pending(target);
      const previousFindings =
        previous?.flags.imageContentVersion === target.version &&
        typeof previous.flags.imageFindings === 'object' &&
        previous.flags.imageFindings !== null
          ? previous.flags.imageFindings
          : {};
      const item = await this.repository.upsertCase(target, {
        sources: ['ai'],
        severity: 60,
        reportCount: await this.repository.countRecentReports(target),
        flags: {
          imageReviewOnly: true,
          imageContentVersion: target.version,
          reasonCode: 'OTHER',
          imageFindings: {
            ...previousFindings,
            [part.id]: {
              assetId: part.assetId,
              inputHash: part.inputHash,
              categories: verdict.categories,
              scores: verdict.scores,
              model: verdict.model,
            },
          },
        },
      });
      await this.outbox.add({ type: 'content.moderation.changed', payload: { scope: 'case', id: item.id } });
    }
    await this.outbox.add({ type: 'content.moderation.changed', payload: { scope: 'scan', id: part.id } });
  }

  async execute(postId: string, occurredAt?: string) {
    const prepared = await this.prepare(postId, occurredAt);
    if (!prepared) return;
    // Sequential claims bound provider load and preserve caption policy before image review.
    for (const part of prepared.parts) {
      const startedAt = new Date().toISOString();
      const claim = await this.claim(part, occurredAt);
      if (!claim) continue;
      const input: ModerationPartInput =
        claim.input.kind === 'caption'
          ? { id: part.id, kind: 'caption', text: claim.input.text! }
          : { id: part.id, kind: 'image', imageUrl: claim.input.url! };
      let results: PartVerdict[] | null = null;
      try {
        results = (await this.ai.moderateParts?.([input])) ?? null;
      } catch {
        /* saved below as retryable failure */
      }
      await this.complete(claim, results?.[0] ?? null, startedAt);
    }
  }

  async recover() {
    const due = await this.repository.db
      .select({ postId: moderationParts.postId })
      .from(moderationParts)
      .where(
        and(
          inArray(moderationParts.status, ['pending', 'waiting', 'deferred', 'checking']),
          sql`${moderationParts.nextAttemptAt} <= now()`,
        ),
      )
      .groupBy(moderationParts.postId)
      .orderBy(sql`min(${moderationParts.nextAttemptAt})`, asc(moderationParts.postId))
      .limit(20);
    for (const { postId } of due) {
      try {
        await this.execute(postId);
      } catch {
        this.logger.warn({ postId }, 'Không phục hồi được lượt quét; giữ trạng thái để thử lại');
      }
    }
  }

  async mediaReady(assetId: string) {
    let after: string | null = null;
    for (;;) {
      const rows = await this.repository.db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            sql`(${posts.coverMediaId} = ${assetId}::uuid OR ${posts.mediaIds} @> ${JSON.stringify([assetId])}::jsonb OR ${posts.tripAttachment}->>'posterMediaId' = ${assetId})`,
            after ? sql`${posts.id} > ${after}::uuid` : undefined,
            inArray(posts.status, ['published', 'held']),
          ),
        )
        .orderBy(asc(posts.id))
        .limit(100);
      for (const row of rows) await this.execute(row.id);
      if (rows.length < 100) break;
      after = rows.at(-1)!.id;
    }
  }

  async detail(postId: string) {
    const target = await this.repository.loadTarget('post', postId);
    if (!target) throw new NotFoundException('Không tìm thấy bài viết');
    const inputs = await this.inputs(target);
    const rows = await this.repository.db
      .select()
      .from(moderationParts)
      .where(
        and(
          eq(moderationParts.postId, postId),
          eq(moderationParts.contentVersion, target.version),
          eq(moderationParts.policyVersion, POLICY),
        ),
      );
    return {
      contentVersion: target.version,
      imagePolicy: 'review_only' as const,
      items: inputs.map((input) => {
        const row = rows.find((r) => r.partKey === input.key && r.inputHash === input.hash);
        return {
          id: row?.id ?? null,
          kind: input.kind,
          assetId: input.assetId,
          mediaKind: input.mediaKind ?? null,
          text: input.text ?? null,
          previewUrl: input.url ?? null,
          status: row?.status ?? (input.state === 'pending' ? 'pending' : input.state),
          attempts: row?.attempts ?? 0,
          model: row?.verdict?.model ?? null,
          categories: row?.verdict?.categories ?? {},
          scores: row?.verdict?.scores ?? {},
          errorCode: row?.errorCode ?? null,
          updatedAt: row?.updatedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  @Transactional('content')
  async retry(id: string, actorId: string) {
    const [part] = await this.repository.db.select().from(moderationParts).where(eq(moderationParts.id, id));
    if (!part) throw new NotFoundException('Không tìm thấy lượt quét');
    await this.repository.lockPost(part.postId);
    const target = await this.repository.loadTarget('post', part.postId);
    const input = target
      ? (await this.inputs(target, true)).find((i) => i.key === part.partKey && i.hash === part.inputHash)
      : null;
    if (
      !target ||
      target.deleted ||
      target.version !== part.contentVersion ||
      !input ||
      input.state !== 'pending' ||
      part.policyVersion !== POLICY
    )
      throw new ConflictException('Đầu vào đã thay đổi hoặc media chưa sẵn sàng');
    const updated = await this.repository.db
      .update(moderationParts)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        errorCode: null,
        verdict: null,
        retriedBy: actorId,
        retriedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(moderationParts.id, id), eq(moderationParts.status, 'failed')))
      .returning();
    if (!updated.length) throw new ConflictException('Chỉ có thể thử lại lượt quét đã hết số lần tự động');
    if (part.kind === 'caption')
      await this.repository.db
        .update(moderationScans)
        .set({ status: 'deferred', attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(eq(moderationScans.eventId, part.id), eq(moderationScans.status, 'failed')));
    await this.outbox.add({
      type: 'content.moderation.changed',
      userId: actorId,
      payload: { scope: 'scan', id },
    });
    return { id, status: 'pending' };
  }

  async exists(id: string) {
    const [row] = await this.repository.db
      .select({ id: moderationParts.id })
      .from(moderationParts)
      .where(eq(moderationParts.id, id));
    return !!row;
  }
}
