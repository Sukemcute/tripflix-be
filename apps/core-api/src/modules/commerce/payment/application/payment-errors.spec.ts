import 'reflect-metadata';
import type { OutboxWriter } from '@tripflix/outbox';
import { CheckoutUseCases } from '../../booking/application/checkout.use-cases.js';
import type { OrderRecord, OrderStore, PaymentRecord } from '../../booking/application/ports.js';
import { MAX_FAILED_PAYMENTS, POLICY_VERSION } from '../../booking/domain/order-rules.js';
import { MemoryCommerceStore } from '../../inventory/infra/memory/memory-commerce.store.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import type { PaymentGateway } from './gateway.port.js';
import { PaymentUseCases } from './payment.use-cases.js';

vi.mock('@tripflix/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tripflix/db')>()),
  Transactional: () => () => undefined,
}));

const NOW = new Date('2026-11-12T00:00:00Z');
const payInput = { paymentToken: 'token-1', expectedTotal: 100_000, acceptedPolicyVersion: POLICY_VERSION };

function setup() {
  const order: OrderRecord = {
    id: 'order-1', userId: 'user-1', status: 'pending', total: 100_000,
    adults: 1, children: 0, infants: 0, sourcePostId: null,
    contactName: 'Nguyễn Văn An', contactPhone: '0901234567', contactEmail: null,
    holdExpiresAt: new Date(NOW.getTime() + 60_000), confirmationCode: null,
    cancelReason: null, createdAt: NOW, paidAt: null,
  };
  const orders = {
    lockOrder: vi.fn<OrderStore['lockOrder']>().mockResolvedValue(order),
    findOrder: vi.fn<OrderStore['findOrder']>().mockResolvedValue(order),
    findItems: vi.fn<OrderStore['findItems']>().mockResolvedValue([]),
    findGuestBirthdates: vi.fn<OrderStore['findGuestBirthdates']>().mockResolvedValue([]),
    countFailedCharges: vi.fn<OrderStore['countFailedCharges']>().mockResolvedValue(0),
    insertPayment: vi.fn<OrderStore['insertPayment']>(),
    updateOrder: vi.fn<OrderStore['updateOrder']>(),
    findPaymentByChallenge: vi.fn<OrderStore['findPaymentByChallenge']>(),
    sellCell: vi.fn<OrderStore['sellCell']>(),
  };
  const gateway = {
    name: 'mock',
    charge: vi.fn<PaymentGateway['charge']>(),
    confirm3ds: vi.fn<PaymentGateway['confirm3ds']>(),
    lookup: vi.fn<PaymentGateway['lookup']>(),
    voidCharge: vi.fn<PaymentGateway['voidCharge']>(),
    refund: vi.fn<PaymentGateway['refund']>(),
  };
  const outbox = { add: vi.fn<OutboxWriter['add']>() };
  const store = orders as unknown as OrderStore;
  const checkout = new CheckoutUseCases(store, new MemoryCommerceStore(), () => '2026-11-12', () => NOW);
  const useCases = new PaymentUseCases(store, gateway, outbox as unknown as OutboxWriter, () => NOW, checkout);
  return { useCases, orders, gateway, outbox, order };
}

describe('PaymentUseCases: lỗi trước khi trừ tiền', () => {
  it('chấp nhận sai phiên bản chính sách thì báo lỗi trường, không ghi khoản trừ hay gọi cổng', async () => {
    const { useCases, orders, gateway, order } = setup();

    const result = useCases.pay(order.userId, order.id, { ...payInput, acceptedPolicyVersion: `${POLICY_VERSION}-old` });
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({
      code: 'invalid_query', field: 'acceptedPolicyVersion', details: { policyVersion: POLICY_VERSION },
    });
    expect(orders.countFailedCharges).not.toHaveBeenCalled();
    expect(orders.insertPayment).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(order.status).toBe('pending');
  });

  it.each([MAX_FAILED_PAYMENTS, MAX_FAILED_PAYMENTS + 1])('đã thất bại %i lần thì giới hạn, không ghi khoản trừ hay gọi cổng', async (count) => {
    const { useCases, orders, gateway, order } = setup();
    orders.countFailedCharges.mockResolvedValue(count);

    const result = useCases.pay(order.userId, order.id, payInput);
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({ code: 'rate_limited', field: undefined, details: undefined });
    expect(orders.countFailedCharges).toHaveBeenCalledExactlyOnceWith(order.id);
    expect(orders.insertPayment).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(order.status).toBe('pending');
  });

  it.each([0, -1])('nhập OTP khi hạn giữ chỗ lệch hiện tại %i ms thì báo hết hạn, không xác thực qua cổng', async (offset) => {
    const { useCases, orders, gateway, outbox, order } = setup();
    order.status = 'paying';
    order.holdExpiresAt = new Date(NOW.getTime() + offset);
    const payment: PaymentRecord = {
      id: 'payment-1', orderId: order.id, userId: order.userId, gatewayKey: 'charge-1', amount: order.total,
      status: 'requires_action', gateway: 'mock', gatewayRef: 'ref-1', failureCode: null,
      cardLast4: '1234', challengeId: 'challenge-1', checkAttempts: 0, createdAt: NOW,
    };
    orders.findPaymentByChallenge.mockResolvedValue(payment);
    const applyResult = vi.spyOn(useCases, 'applyResult').mockResolvedValue({ kind: 'failed', code: '3ds_expired' });

    const result = useCases.confirm3ds(order.userId, order.id, { challengeId: 'challenge-1', otp: '123456' });
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({ code: 'gone', field: undefined, details: undefined });
    expect(orders.findPaymentByChallenge).toHaveBeenCalledExactlyOnceWith(order.id, 'challenge-1');
    expect(applyResult).toHaveBeenCalledExactlyOnceWith(payment.gatewayKey, { status: 'failed', code: '3ds_expired' });
    expect(gateway.confirm3ds).not.toHaveBeenCalled();
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(orders.insertPayment).not.toHaveBeenCalled();
    expect(orders.sellCell).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });
});
