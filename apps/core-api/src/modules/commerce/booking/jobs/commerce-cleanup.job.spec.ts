import { IDEMPOTENCY_BATCH_SIZE, runCommerceCleanup } from './commerce-cleanup.job.js';

describe('runCommerceCleanup', () => {
  const now = new Date('2026-11-12T10:30:00.000Z');

  it('cộng số dòng qua các lô và dừng ngay khi lô cuối chưa đầy', async () => {
    const deleteExpiredIdempotencyBatch = vi
      .fn<(before: Date, limit: number) => Promise<number>>()
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(3);
    const deletePublishedEventsBefore = vi.fn<(before: Date) => Promise<number>>().mockResolvedValue(7);

    const result = await runCommerceCleanup({
      now,
      deleteExpiredIdempotencyBatch,
      deletePublishedEventsBefore,
    });

    expect(result).toEqual({ expiredIdempotencyKeys: 10_003, publishedEvents: 7 });
    expect(deleteExpiredIdempotencyBatch.mock.calls).toEqual([
      [now, IDEMPOTENCY_BATCH_SIZE],
      [now, IDEMPOTENCY_BATCH_SIZE],
      [now, IDEMPOTENCY_BATCH_SIZE],
    ]);
    expect(deletePublishedEventsBefore).toHaveBeenCalledExactlyOnceWith(new Date('2026-11-05T10:30:00.000Z'));
  });

  it('vẫn dọn outbox khi lô idempotency đầu tiên rỗng', async () => {
    const deleteExpiredIdempotencyBatch = vi
      .fn<(before: Date, limit: number) => Promise<number>>()
      .mockResolvedValue(0);
    const deletePublishedEventsBefore = vi.fn<(before: Date) => Promise<number>>().mockResolvedValue(2);

    expect(
      await runCommerceCleanup({ now, deleteExpiredIdempotencyBatch, deletePublishedEventsBefore }),
    ).toEqual({ expiredIdempotencyKeys: 0, publishedEvents: 2 });
    expect(deleteExpiredIdempotencyBatch).toHaveBeenCalledExactlyOnceWith(now, IDEMPOTENCY_BATCH_SIZE);
    expect(deletePublishedEventsBefore).toHaveBeenCalledExactlyOnceWith(new Date('2026-11-05T10:30:00.000Z'));
  });

  it('đọc thêm lô rỗng khi số dòng hết hạn vừa đủ một lô', async () => {
    const deleteExpiredIdempotencyBatch = vi
      .fn<(before: Date, limit: number) => Promise<number>>()
      .mockResolvedValueOnce(IDEMPOTENCY_BATCH_SIZE)
      .mockResolvedValueOnce(0);
    const deletePublishedEventsBefore = vi.fn<(before: Date) => Promise<number>>().mockResolvedValue(0);

    expect(
      await runCommerceCleanup({ now, deleteExpiredIdempotencyBatch, deletePublishedEventsBefore }),
    ).toEqual({ expiredIdempotencyKeys: IDEMPOTENCY_BATCH_SIZE, publishedEvents: 0 });
    expect(deleteExpiredIdempotencyBatch).toHaveBeenCalledTimes(2);
  });
});
