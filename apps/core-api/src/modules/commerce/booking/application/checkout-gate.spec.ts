import 'reflect-metadata';
import { CommerceError } from '../../inventory/domain/errors.js';
import { MemoryCommerceStore } from '../../inventory/infra/memory/memory-commerce.store.js';
import { CheckoutUseCases, type CheckoutInput, type CheckoutView } from './checkout.use-cases.js';
import type { OrderStore } from './ports.js';

interface HoldRunner {
  holdAndCreateOrder(userId: string, input: CheckoutInput): Promise<string>;
}

function createPendingHold() {
  let resolve!: (orderId: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createInput(productId = 'room-1', checkIn = '2026-12-01'): CheckoutInput {
  return { adults: 1, items: [{ productId, checkIn, checkOut: '2026-12-03', qty: 1 }] };
}

function setup(holdPromise: Promise<string>) {
  const orders = { isLockWaitTimeout: vi.fn<OrderStore['isLockWaitTimeout']>().mockReturnValue(false) };
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
  it('lượt thứ tư cùng ô bị từ chối trước khi giữ chỗ', async () => {
    const pending = createPendingHold();
    const { useCases, hold, getCheckout } = setup(pending.promise);
    const input = createInput();
    const running = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-${index}`, input));
    const blocked = useCases.checkout('user-4', input);

    try {
      expect(hold).toHaveBeenCalledTimes(3);
      await expect(blocked).rejects.toBeInstanceOf(CommerceError);
      await expect(blocked).rejects.toMatchObject({ code: 'conflict', field: 'items', details: { reason: 'LOCK_BUSY' } });
      expect(getCheckout).not.toHaveBeenCalled();
    } finally {
      pending.resolve('order-1');
      await Promise.allSettled([...running, blocked]);
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

    try {
      expect(hold).toHaveBeenCalledTimes(4);
      expect(hold).toHaveBeenLastCalledWith('user-other', otherInput);
      pending.resolve('order-1');
      await expect(other).resolves.toEqual(view);
    } finally {
      pending.resolve('order-1');
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

    if (outcome === 'thành công') pending.resolve('order-1');
    else pending.reject(error);

    const outcomes = await settled;
    for (const result of outcomes) {
      if (outcome === 'thành công') expect(result).toEqual({ status: 'fulfilled', value: view });
      else expect(result).toEqual({ status: 'rejected', reason: error });
    }

    hold.mockResolvedValue('order-next');
    const next = Array.from({ length: 3 }, (_, index) => useCases.checkout(`user-next-${index}`, input));
    await expect(Promise.all(next)).resolves.toEqual([view, view, view]);
    expect(hold).toHaveBeenCalledTimes(6);
    expect(getCheckout).toHaveBeenCalledWith('user-next-2', 'order-next', { isNewOrder: true });
  });
});
