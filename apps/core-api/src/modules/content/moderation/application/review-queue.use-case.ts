import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { eq } from 'drizzle-orm';
import { moderationCases, moderationReviewAudit } from '../../db/schema/index.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { REVIEW_LEASE_MINUTES } from '../domain/review-policy.js';

export class ReviewQueueUseCase {
  constructor(private readonly repository: ModerationRepository) {}

  @Transactional('content')
  async execute(id: string, actorId: string, action: 'claim' | 'renew' | 'release', leaseId?: string) {
    const initial = await this.repository.findCase(id);
    if (!initial) throw new NotFoundException('Không tìm thấy hồ sơ');
    await this.repository.lockPost(initial.postId);
    const [item] = await this.repository.db
      .select()
      .from(moderationCases)
      .where(eq(moderationCases.id, id))
      .for('update');
    if (!item || item.status !== 'pending') throw new ConflictException('Hồ sơ đã được xử lý');
    const active = !!item.assigneeId && !!item.leaseExpiresAt && item.leaseExpiresAt.getTime() > Date.now();
    if (action === 'claim' && active) {
      if (item.assigneeId !== actorId) throw new ConflictException('Hồ sơ đang có người xử lý');
      return item;
    }
    if (action !== 'claim' && (!active || item.assigneeId !== actorId || item.leaseId !== leaseId))
      throw new ConflictException('Phiên nhận hồ sơ đã thay đổi hoặc hết hạn');
    const nextLeaseId = action === 'claim' ? randomUUID() : item.leaseId;
    const [updated] = await this.repository.db
      .update(moderationCases)
      .set({
        assigneeId: action === 'release' ? null : actorId,
        leaseId: action === 'release' ? null : nextLeaseId,
        leaseExpiresAt: action === 'release' ? null : new Date(Date.now() + REVIEW_LEASE_MINUTES * 60_000),
        updatedAt: new Date(),
      })
      .where(eq(moderationCases.id, id))
      .returning();
    await this.repository.db
      .insert(moderationReviewAudit)
      .values({ caseId: id, actorId, action, leaseId: nextLeaseId });
    return updated!;
  }

  @Transactional('content')
  async recordEvidenceView(caseId: string, actorId: string) {
    await this.repository.db
      .insert(moderationReviewAudit)
      .values({ caseId, actorId, action: 'evidence_view' });
    return { recorded: true };
  }
}
