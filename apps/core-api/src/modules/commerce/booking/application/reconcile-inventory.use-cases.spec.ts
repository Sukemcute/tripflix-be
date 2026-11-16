import { describe, expect, it, vi } from 'vitest';
import { ReconcileInventoryUseCases } from './reconcile-inventory.use-cases.js';
import type { InventoryDrift, OrderStore } from './ports.js';

describe('ReconcileInventoryUseCases (K4)', () => {
  it('hỏi lệch từ hôm nay và trả về để báo, không sửa kho', async () => {
    const drift: InventoryDrift = { productType: 'room', productId: 'A', date: '2026-12-01', held: 1, expectedHeld: 2, sold: 0, expectedSold: 0 };
    const findInventoryDrift = vi.fn<OrderStore['findInventoryDrift']>().mockResolvedValue([drift]);
    const useCases = new ReconcileInventoryUseCases({ findInventoryDrift } as unknown as OrderStore, () => '2026-11-16');
    expect(await useCases.reconcile()).toEqual({ drifts: [drift] });
    expect(findInventoryDrift).toHaveBeenCalledWith({ fromDate: '2026-11-16', limit: 50 });
  });
});
