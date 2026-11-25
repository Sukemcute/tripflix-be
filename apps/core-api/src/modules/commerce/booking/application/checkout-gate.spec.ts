import 'reflect-metadata';
import { MemoryCommerceStore } from '../../inventory/infra/memory/memory-commerce.store.js';
import { CheckoutUseCases, type CheckoutInput, type CheckoutView } from './checkout.use-cases.js';
import type { OrderRecord, OrderStore } from './ports.js';

interface HoldRunner {
  holdAndCreateOrder(userId: string, input: CheckoutInput): Promise<OrderRecord>;
}

/** Đơn vừa tạo: cổng giữ chỗ chỉ đọc id rồi chuyển nguyên bản ghi cho getCheckout. */
const createdOrder = (id: string) => ({ id, userId: 'user-next-2' }) as OrderRecord;

function createPendingHold() {
  let resolve!: (order: OrderRecord) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<OrderRecord>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Chờ cổng giữ chỗ (async) cho các lượt vào. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createInput(productId = 'room-1', checkIn = '2026-12-01'): CheckoutInput {
  return { adults: 1, items: [{ productId, checkIn, checkOut: '2026-12-03', qty: 1 }] };
}

function setup(holdPromise: Promise<OrderRecord>) {
  const orders = { isLockWaitTimeout: vi.fn<OrderStore['isLockWaitTimeout']>().mockReturnValue(false), isDeadlock: vi.fn<OrderStore['isDeadlock']>().mockReturnValue(false) };
  const useCases = new CheckoutUseCases(
    orders as unknown as OrderStore,
    new MemoryCommerceStore(),
    () => '2026-11-12',
    () => new Date('2026-11-12T00:00:00Z'),
  );
  const view: CheckoutView = {
    orderId: 'order-1',
    status: 'pending',
    holdExpiresAt: '2026-11-12T00:30:00.000Z',
    total: 100_000,
    adults: 1,
    children: 0,
    infants: 0,
    confirmationCode: null,
    cancelReason: null,
    items: [],
    isGuestInfoComplete: false,
    passengersRequired: 0,
    passengerTypes: [],
    policyVersion: '2026-11-03',
  };
  const hold = vi.spyOn(useCases as unknown as HoldRunner, 'holdAndCreateOrder').mockReturnValue(holdPromise);
  const getCheckout = vi.spyOn(useCases, 'getCheckout').mockResolvedValue(view);
  return { useCases, hold, getCheckout, view };
}

describe('CheckoutUseCases: cổng giữ chỗ', () => {
  it('lượt thứ tư cùng ô xếp hàng, không gọi database, được vào khi có lượt xong', async () => {
    const pending = createPendingHold();
    const { useCases, hold, view } = setup(pending.promise);
    const input = createInput();
    const running = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-${index}`, input));
    const queued = useCases.checkout('user-4', input);
    await flush();
    expect(hold).toHaveBeenCalledTimes(3);

    pending.resolve(createdOrder('order-1'));
    await expect(queued).resolves.toEqual(view);
    expect(hold).toHaveBeenCalledTimes(4);
    await Promise.allSettled(running);
  });

  it('chờ quá 2 giây thì trả 409 LOCK_BUSY, không giữ chỗ', async () => {
    vi.useFakeTimers();
    const pending = createPendingHold();
    const { useCases, hold, getCheckout } = setup(pending.promise);
    const input = createInput();
    const running = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-${index}`, input));
    const blocked = useCases.checkout('user-4', input);
    const outcome = expect(blocked).rejects.toMatchObject({ code: 'conflict', field: 'items', details: { reason: 'LOCK_BUSY' } });
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await outcome;
      expect(hold).toHaveBeenCalledTimes(3);
      expect(getCheckout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      pending.resolve(createdOrder('order-1'));
      await Promise.allSettled(running);
    }
  });

  it.each([
    { label: 'khác sản phẩm', productId: 'room-2', checkIn: '2026-12-01' },
    { label: 'khác ngày', productId: 'room-1', checkIn: '2026-12-02' },
  ])('ô $label vẫn được giữ chỗ', async ({ productId, checkIn }) => {
    const pending = createPendingHold();
    const { useCases, hold, view } = setup(pending.promise);
    const running = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-${index}`, createInput()));
    const otherInput = createInput(productId, checkIn);
    const other = useCases.checkout('user-other', otherInput);
    await flush();

    try {
      expect(hold).toHaveBeenCalledTimes(4);
      expect(hold).toHaveBeenLastCalledWith('user-other', otherInput);
      pending.resolve(createdOrder('order-1'));
      await expect(other).resolves.toEqual(view);
    } finally {
      pending.resolve(createdOrder('order-1'));
      await Promise.allSettled([...running, other]);
    }
  });

  it.each(['thành công', 'thất bại'] as const)('nhả đủ lượt khi giữ chỗ %s', async (outcome) => {
    const pending = createPendingHold();
    const { useCases, hold, getCheckout, view } = setup(pending.promise);
    const input = createInput();
    const running = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-${index}`, input));
    const settled = Promise.allSettled(running);
    const error = new Error('Không giữ được chỗ');

    if (outcome === 'thành công') pending.resolve(createdOrder('order-1'));
    else pending.reject(error);

    const outcomes = await settled;
    for (const result of outcomes) {
      if (outcome === 'thành công') expect(result).toEqual({ status: 'fulfilled', value: view });
      else expect(result).toEqual({ status: 'rejected', reason: error });
    }

    hold.mockResolvedValue(createdOrder('order-next'));
    const next = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-next-${index}`, input));
    await expect(Promise.all(next)).resolves.toEqual([view, view, view]);
    expect(hold).toHaveBeenCalledTimes(6);
    expect(getCheckout).toHaveBeenCalledWith('user-next-2', 'order-next', { isNewOrder: true, newOrder: createdOrder('order-next') });
  });
});

describe('CheckoutUseCases: deadlock khi giữ chỗ (K2)', () => {
  it('gặp deadlock thì chạy lại đúng một lần, lần sau thành công', async () => {
    const { useCases, hold, view } = setup(Promise.resolve(createdOrder('order-1')));
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    hold.mockReset().mockRejectedValueOnce(deadlock).mockResolvedValueOnce(createdOrder('order-1'));
    (useCases as unknown as { orders: { isDeadlock: (e: unknown) => boolean } }).orders.isDeadlock = (e) => e === deadlock;
    await expect(useCases.checkout('user-1', createInput())).resolves.toEqual(view);
    expect(hold).toHaveBeenCalledTimes(2);
  });

  it('deadlock hai lần liên tiếp thì báo lỗi, không lặp mãi', async () => {
    const { useCases, hold } = setup(Promise.resolve(createdOrder('order-1')));
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    hold.mockReset().mockRejectedValue(deadlock);
    (useCases as unknown as { orders: { isDeadlock: (e: unknown) => boolean } }).orders.isDeadlock = (e) => e === deadlock;
    await expect(useCases.checkout('user-1', createInput())).rejects.toBe(deadlock);
    expect(hold).toHaveBeenCalledTimes(2);
  });
});
