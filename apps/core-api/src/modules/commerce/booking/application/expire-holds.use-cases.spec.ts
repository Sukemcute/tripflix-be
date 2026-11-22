import { describe, expect, it, vi } from 'vitest';
import { ExpireHoldsUseCases } from './expire-holds.use-cases.js';
import type { CheckoutUseCases } from './checkout.use-cases.js';
import type { OrderStore } from './ports.js';

vi.mock('@tripflix/db', () => ({ Transactional: () => () => undefined }));

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

it('nhả chỗ quá hạn của khoản thanh toán demo đang chờ khi cổng đã tắt', async () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const orders = {
    findExpiredHoldIds: vi.fn().mockResolvedValue(['order-1']),
    lockOrderSkipLocked: vi.fn().mockResolvedValue({ status: 'paying', holdExpiresAt: now }),
    findPaymentsOfOrder: vi.fn().mockResolvedValue([{ id: 'payment-1', status: 'initiated' }]),
    lockPaymentSkipLocked: vi.fn().mockResolvedValue({ gateway: 'mock', status: 'initiated' }),
    updatePayment: vi.fn().mockResolvedValue(undefined),
  };
  const checkout = { releaseOrder: vi.fn().mockResolvedValue(undefined) };
  const useCases = new ExpireHoldsUseCases(orders as unknown as OrderStore, () => now, checkout as unknown as CheckoutUseCases, null);

  expect(await useCases.expireHolds()).toEqual({ expired: 1, skipped: 0, errors: 0 });
  expect(orders.findExpiredHoldIds).toHaveBeenCalledWith(expect.objectContaining({ disabledCardGateway: 'mock', now }));
  expect(orders.updatePayment).toHaveBeenCalledWith('payment-1', { status: 'failed', failureCode: 'mock_gateway_disabled' });
  expect(checkout.releaseOrder).toHaveBeenCalledWith('order-1', 'expired', expect.any(String));
});
