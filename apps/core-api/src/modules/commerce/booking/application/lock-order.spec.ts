import { describe, expect, it } from 'vitest';
import { listCellLockOrder } from './checkout.use-cases.js';
import type { InventoryCell } from './ports.js';

const cell = (productId: string, date: string): InventoryCell => ({ productType: 'room', productId, date, qty: 1 });

describe('listCellLockOrder (K2)', () => {
  it('ô nhả và ô giữ nằm chung một thứ tự (sản phẩm, ngày), không nhả hết rồi mới giữ', () => {
    // Kịch bản tái hiện deadlock: giỏ cũ giữ 05/12, giỏ mới giữ 03/12.
    const order = listCellLockOrder([cell('A', '2026-12-05')], [cell('A', '2026-12-03')]);
    expect(order.map((o) => [o.cell.date, o.isRelease])).toEqual([
      ['2026-12-03', false],
      ['2026-12-05', true],
    ]);
  });

  it('cùng ô thì nhả trước để chỗ vừa trả giữ lại được ngay', () => {
    const order = listCellLockOrder([cell('A', '2026-12-03')], [cell('A', '2026-12-03'), cell('B', '2026-12-01')]);
    expect(order.map((o) => [o.cell.productId, o.isRelease])).toEqual([
      ['A', true],
      ['A', false],
      ['B', false],
    ]);
  });
});
