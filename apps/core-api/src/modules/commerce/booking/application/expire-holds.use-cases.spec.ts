import { describe, expect, it, vi } from 'vitest';
import { ExpireHoldsUseCases } from './expire-holds.use-cases.js';
import type { CheckoutUseCases } from './checkout.use-cases.js';
import type { OrderStore } from './ports.js';

type ExpireRunner = { expireOrder: (orderId: string) => Promise<boolean> };
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function setup(batches: string[][]) {
  const findExpiredHoldIds = vi.fn<OrderStore['findExpiredHoldIds']>();
  for (const batch of batches) findExpiredHoldIds.mockResolvedValueOnce(batch);
  findExpiredHoldIds.mockResolvedValue([]);
  const useCases = new ExpireHoldsUseCases({ findExpiredHoldIds } as unknown as OrderStore, () => new Date('2026-12-01T00:00:00Z'), {} as CheckoutUseCases);
  return { useCases, findExpiredHoldIds };
}

describe('ExpireHoldsUseCases: lặp tới khi hết (K1)', () => {
  it('lô đầy thì lấy tiếp trong cùng lượt chạy, không đợi phút sau', async () => {
    const { useCases, findExpiredHoldIds } = setup([ids(500, 'a'), ids(500, 'b'), ids(200, 'c')]);
    vi.spyOn(useCases as unknown as ExpireRunner, 'expireOrder').mockResolvedValue(true);
    expect(await useCases.expireHolds()).toEqual({ expired: 1200, skipped: 0, errors: 0 });
    expect(findExpiredHoldIds).toHaveBeenCalledTimes(3);
  });

  it('cả lô không nhả được đơn nào (đang bị khoá) thì dừng, không lặp mãi trên cùng lô', async () => {
    const { useCases, findExpiredHoldIds } = setup([ids(500, 'a'), ids(500, 'a')]);
    vi.spyOn(useCases as unknown as ExpireRunner, 'expireOrder').mockResolvedValue(false);
    expect(await useCases.expireHolds()).toEqual({ expired: 0, skipped: 500, errors: 0 });
    expect(findExpiredHoldIds).toHaveBeenCalledTimes(1);
  });
});
