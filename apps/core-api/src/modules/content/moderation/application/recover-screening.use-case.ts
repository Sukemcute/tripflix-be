import { Transactional } from '@tripflix/db';
import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { moderationScans } from '../../db/schema/index.js';
import { ModerationRepository } from '../infra/moderation.repository.js';

export class ClaimDeferredScansUseCase {
  constructor(private readonly repository: ModerationRepository) {}
  @Transactional('content')
  execute() {
    return this.repository.claimDeferredScans();
  }
  @Transactional('content')
  async retry(eventId: string, actorId: string) {
    const [scan] = await this.repository.db
      .update(moderationScans)
      .set({
        status: 'deferred',
        attempts: 0,
        nextAttemptAt: sql`now()`,
        retriedBy: actorId,
        retriedAt: new Date(),
      })
      .where(and(eq(moderationScans.eventId, eventId), eq(moderationScans.status, 'failed')))
      .returning();
    if (!scan) throw new ConflictException('Chỉ thử lại scan đã hết số lần tự động');
    return { eventId: scan.eventId, status: scan.status };
  }
}
