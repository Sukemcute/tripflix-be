import { ConflictException } from '@nestjs/common';
import type { Db } from '@tripflix/db';
import { and, eq } from 'drizzle-orm';
import { moderationCases, type ModerationTarget } from '../../db/schema/index.js';

/** Caller locks the post first, matching report, screening and decision lock order. */
export async function assertReviewLease(
  db: Db,
  targetType: ModerationTarget,
  targetId: string,
  actorId: string,
  leaseId?: string,
) {
  const [item] = await db
    .select()
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.targetType, targetType),
        eq(moderationCases.targetId, targetId),
        eq(moderationCases.status, 'pending'),
      ),
    )
    .for('update');
  if (
    item?.assigneeId &&
    (item.assigneeId !== actorId ||
      !item.leaseExpiresAt ||
      item.leaseExpiresAt.getTime() <= Date.now() ||
      (leaseId && item.leaseId !== leaseId))
  )
    throw new ConflictException(
      'Hồ sơ đang do người khác xử lý hoặc phiên nhận đã hết hạn. Hãy tải lại và nhận hồ sơ.',
    );
  if (leaseId && (!item || item.leaseId !== leaseId))
    throw new ConflictException('Phiên nhận hồ sơ đã thay đổi.');
}
