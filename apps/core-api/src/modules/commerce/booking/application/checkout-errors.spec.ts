import 'reflect-metadata';
import { MemoryCommerceStore } from '../../inventory/infra/memory/memory-commerce.store.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { HOLDS_PER_HOUR } from '../domain/order-rules.js';
import { CheckoutUseCases, type CheckoutInput } from './checkout.use-cases.js';
import type { OrderRecord, OrderStore } from './ports.js';

vi.mock('@tripflix/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tripflix/db')>()),
  Transactional: () => () => undefined,
}));

const NOW = new Date('2026-11-12T00:00:00Z');
const input: CheckoutInput = {
  adults: 1,
  items: [{ productId: 'room-1', checkIn: '2026-12-01', checkOut: '2026-12-02', qty: 1 }],
};

function setup() {
  const orders = {
    limitLockWait: vi.fn<OrderStore['limitLockWait']>(),
    lockUser: vi.fn<OrderStore['lockUser']>(),
    isDeadlock: vi.fn<OrderStore['isDeadlock']>().mockReturnValue(false),
    isLockWaitTimeout: vi.fn<OrderStore['isLockWaitTimeout']>().mockReturnValue(false),
    countOrdersCreatedSince: vi.fn<OrderStore['countOrdersCreatedSince']>().mockResolvedValue(0),
    lockOrdersOfUser: vi.fn<OrderStore['lockOrdersOfUser']>().mockResolvedValue([]),
    findItems: vi.fn<OrderStore['findItems']>().mockResolvedValue([]),
    holdCell: vi.fn<OrderStore['holdCell']>().mockResolvedValue(true),
    releaseCell: vi.fn<OrderStore['releaseCell']>(),
    updateOrder: vi.fn<OrderStore['updateOrder']>(),
    insertOrder: vi.fn<OrderStore['insertOrder']>(),
    insertItems: vi.fn<OrderStore['insertItems']>(),
  };
  const useCases = new CheckoutUseCases(orders as unknown as OrderStore, new MemoryCommerceStore(), () => '2026-11-12', () => NOW);
  vi.spyOn(useCases, 'priceItems').mockResolvedValue([{
    productType: 'room', productId: 'room-1', productName: 'Phòng tiêu chuẩn',
    date: '2026-12-01', nights: 1, qty: 1, unitPrice: 100_000, lineTotal: 100_000,
    childUnitPrice: null, infantUnitPrice: null, ratePlanCode: 'RO', ratePlanName: 'Chỉ phòng',
    isRefundable: true, freeCancelUntil: null,
    cells: [{ productType: 'room', productId: 'room-1', date: '2026-12-01', qty: 1 }],
  }]);
  return { useCases, orders };
}

describe('CheckoutUseCases: lỗi trước khi giữ chỗ', () => {
  it.each([HOLDS_PER_HOUR, HOLDS_PER_HOUR + 1])('đã tạo %i đơn trong một giờ thì giới hạn, không giữ chỗ', async (count) => {
    const { useCases, orders } = setup();
    orders.countOrdersCreatedSince.mockResolvedValue(count);

    const result = useCases.checkout('user-1', input);
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({ code: 'rate_limited', field: undefined, details: undefined });
    expect(orders.countOrdersCreatedSince).toHaveBeenCalledExactlyOnceWith('user-1', new Date(NOW.getTime() - 3_600_000));
    expect(orders.lockOrdersOfUser).not.toHaveBeenCalled();
    expect(orders.holdCell).not.toHaveBeenCalled();
    expect(orders.releaseCell).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    expect(orders.insertOrder).not.toHaveBeenCalled();
    expect(orders.insertItems).not.toHaveBeenCalled();
  });

  it('có đơn đang thanh toán còn hạn thì báo xung đột, không nhả giỏ cũ hay giữ chỗ mới', async () => {
    const { useCases, orders } = setup();
    const pending: OrderRecord = {
      id: 'order-old', userId: 'user-1', status: 'pending', total: 100_000,
      adults: 1, children: 0, infants: 0, sourcePostId: null,
      contactName: null, contactPhone: null, contactEmail: null,
      holdExpiresAt: new Date(NOW.getTime() + 60_000), confirmationCode: null,
      cancelReason: null, createdAt: NOW, paidAt: null,
    };
    orders.lockOrdersOfUser.mockResolvedValue([pending, { ...pending, id: 'order-paying', status: 'paying' }]);

    const result = useCases.checkout('user-1', input);
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({
      code: 'conflict', field: undefined, details: undefined,
      message: 'Bạn có một đơn đang thanh toán, vui lòng chờ kết quả trước khi giữ giỏ mới.',
    });
    expect(orders.lockOrdersOfUser).toHaveBeenCalledExactlyOnceWith('user-1', ['pending', 'paying']);
    expect(orders.findItems).not.toHaveBeenCalled();
    expect(orders.releaseCell).not.toHaveBeenCalled();
    expect(orders.holdCell).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    expect(orders.insertOrder).not.toHaveBeenCalled();
    expect(orders.insertItems).not.toHaveBeenCalled();
    expect(pending.status).toBe('pending');
  });
});
