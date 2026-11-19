import { describe, expect, it, vi } from 'vitest';
import type { OutboxWriter } from '@tripflix/outbox';
import type { CheckoutUseCases } from './checkout.use-cases.js';
import type { OrderItemRecord, OrderRecord, OrderStore } from './ports.js';

// Unit test không mở transaction thật: decorator chỉ chạy thẳng hàm.
vi.mock('@tripflix/db', () => ({ Transactional: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor }));

const { DepartureReminderUseCases } = await import('./departure-reminder.use-cases.js');

const NOW = new Date('2026-11-30T08:00:00Z'); // 15:00 giờ Việt Nam ngày 30/11

const order = (id: string, status: OrderRecord['status'] = 'paid'): OrderRecord =>
  ({ id, userId: '00000000-0000-4000-8000-000000000001', status, confirmationCode: 'TFABC123', contactName: 'An', contactEmail: 'an@example.com' }) as OrderRecord;
const room = (orderId: string, date: string): OrderItemRecord =>
  ({ id: `${orderId}-room`, orderId, productType: 'room', productId: 'rt-1', productName: 'Phòng đôi', propertyName: 'KS Biển', date, nights: 2 }) as OrderItemRecord;

/** Kho giả có departure_reminded_at và UPDATE ... WHERE IS NULL như database: lượt sau không đánh dấu lại được. */
function setup(orders: OrderRecord[], items: Record<string, OrderItemRecord[]>) {
  const remindedAt = new Map<string, Date>();
  const store = {
    findDepartureReminderCandidateIds: vi.fn(async () => orders.filter((o) => o.status === 'paid' && !remindedAt.has(o.id)).map((o) => o.id)),
    findOrder: vi.fn(async (id: string) => orders.find((o) => o.id === id) ?? null),
    findItems: vi.fn(async (id: string) => items[id] ?? []),
    markDepartureReminded: vi.fn(async (id: string, at: Date) => {
      if (remindedAt.has(id) || orders.find((o) => o.id === id)?.status !== 'paid') return false;
      remindedAt.set(id, at);
      return true;
    }),
  };
  const outbox = { add: vi.fn(async () => undefined) };
  const checkout = { findFlightRoutes: vi.fn(async () => new Map()) };
  const create = () =>
    new DepartureReminderUseCases(store as unknown as OrderStore, () => NOW, () => '2026-11-30', checkout as unknown as CheckoutUseCases, outbox as unknown as OutboxWriter);
  return { create, store, outbox };
}

describe('DepartureReminderUseCases (TF37)', () => {
  it('đơn đã trả nhận phòng trong 24 giờ tới thì ghi một sự kiện nhắc', async () => {
    const { create, outbox } = setup([order('o1')], { o1: [room('o1', '2026-12-01')] });
    expect(await create().remindDepartures()).toEqual({ reminded: 1, skipped: 0, errors: 0 });
    expect(outbox.add).toHaveBeenCalledTimes(1);
    expect(outbox.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commerce.order.departure_reminder', payload: expect.objectContaining({ orderId: 'o1', startAt: '2026-12-01T07:00:00.000Z', contactEmail: 'an@example.com' }) }),
    );
  });

  it('chạy lại không gửi trùng', async () => {
    const { create, outbox } = setup([order('o1')], { o1: [room('o1', '2026-12-01')] });
    const useCases = create();
    await useCases.remindDepartures();
    expect(await useCases.remindDepartures()).toEqual({ reminded: 0, skipped: 0, errors: 0 });
    expect(outbox.add).toHaveBeenCalledTimes(1);
  });

  it('hai instance chạy cùng lúc trên cùng đơn: chỉ một bên ghi sự kiện', async () => {
    const { create, outbox } = setup([order('o1')], { o1: [room('o1', '2026-12-01')] });
    const results = await Promise.all([create().remindDepartures(), create().remindDepartures()]);
    expect(results.map((r) => r.reminded).sort()).toEqual([0, 1]);
    expect(outbox.add).toHaveBeenCalledTimes(1);
  });

  it('chưa tới 24 giờ hoặc chuyến đã bắt đầu thì chưa nhắc, không đánh dấu', async () => {
    const { create, outbox, store } = setup([order('far'), order('started')], { far: [room('far', '2026-12-02')], started: [room('started', '2026-11-30')] });
    expect(await create().remindDepartures()).toEqual({ reminded: 0, skipped: 2, errors: 0 });
    expect(store.markDepartureReminded).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('đơn vừa bị huỷ giữa lúc đọc và lúc đánh dấu thì không nhắc', async () => {
    const o1 = order('o1');
    const { create, outbox, store } = setup([o1], { o1: [room('o1', '2026-12-01')] });
    store.findOrder.mockImplementationOnce(async () => {
      const snapshot = { ...o1 };
      o1.status = 'cancelled';
      return snapshot;
    });
    expect(await create().remindDepartures()).toEqual({ reminded: 0, skipped: 1, errors: 0 });
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('một đơn lỗi không chặn đơn khác', async () => {
    const { create, outbox, store } = setup([order('bad'), order('ok')], { bad: [room('bad', '2026-12-01')], ok: [room('ok', '2026-12-01')] });
    store.findItems.mockRejectedValueOnce(new Error('db down'));
    expect(await create().remindDepartures()).toEqual({ reminded: 1, skipped: 0, errors: 1 });
    expect(outbox.add).toHaveBeenCalledTimes(1);
  });
});
