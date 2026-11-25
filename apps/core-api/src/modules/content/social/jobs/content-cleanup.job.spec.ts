import { describe, expect, it, vi } from 'vitest';
import { IDEMPOTENCY_BATCH_SIZE, runContentCleanup } from './content-cleanup.job.js';

describe('runContentCleanup', () => {
  const now = new Date('2026-11-23T10:30:00.000Z');

  it('xoá khoá idempotency theo lô tới khi lô chưa đầy, rồi xoá outbox đã gửi quá 7 ngày', async () => {
    const deleteExpiredIdempotencyBatch = vi
      .fn<(before: Date, limit: number) => Promise<number>>()
      .mockResolvedValueOnce(IDEMPOTENCY_BATCH_SIZE)
      .mockResolvedValueOnce(4);
    const deletePublishedEventsBefore = vi.fn<(before: Date) => Promise<number>>().mockResolvedValue(9);

    const result = await runContentCleanup({ now, deleteExpiredIdempotencyBatch, deletePublishedEventsBefore });

    expect(result).toEqual({ expiredIdempotencyKeys: IDEMPOTENCY_BATCH_SIZE + 4, publishedEvents: 9 });
    expect(deleteExpiredIdempotencyBatch).toHaveBeenCalledTimes(2);
    expect(deletePublishedEventsBefore).toHaveBeenCalledExactlyOnceWith(new Date('2026-11-16T10:30:00.000Z'));
  });
});
