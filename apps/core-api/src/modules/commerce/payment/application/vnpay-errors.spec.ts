import 'reflect-metadata';
import type { OrderStore, PaymentRecord } from '../../booking/application/ports.js';
import { POLICY_VERSION } from '../../booking/domain/order-rules.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { VNPAY_GATEWAY, buildVnpayTxnRef } from '../domain/vnpay-signature.js';
import type { PaymentUseCases } from './payment.use-cases.js';
import { VnpayUseCases, type VnpayConfig } from './vnpay.use-cases.js';

vi.mock('@tripflix/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tripflix/db')>()),
  Transactional: () => () => undefined,
}));

const config: VnpayConfig = {
  tmnCode: 'TESTCODE', hashSecret: 'test-merchant-secret',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'https://tripflix.example/payment/return',
};
const input = { expectedTotal: 100_000, acceptedPolicyVersion: POLICY_VERSION, clientIp: '127.0.0.1' };

function setup() {
  const orders = {
    findPaymentsByKey: vi.fn<OrderStore['findPaymentsByKey']>(),
    insertPayment: vi.fn<OrderStore['insertPayment']>(),
    updateOrder: vi.fn<OrderStore['updateOrder']>(),
  };
  const payment = {
    prepareCharge: vi.fn<PaymentUseCases['prepareCharge']>(),
    applyResult: vi.fn<PaymentUseCases['applyResult']>(),
  };
  const useCases = new VnpayUseCases(config, orders as unknown as OrderStore, payment as unknown as PaymentUseCases);
  return { useCases, orders, payment };
}

describe('VnpayUseCases: lỗi khi bắt đầu thanh toán', () => {
  it('giá đã đổi thì báo xung đột kèm giá cũ và mới, không tạo thanh toán', async () => {
    const { useCases, orders, payment } = setup();
    payment.prepareCharge.mockResolvedValue({ kind: 'price_changed', oldTotal: 100_000, newTotal: 120_000 });

    const result = useCases.startPayment('user-1', 'order-1', input);
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({
      code: 'conflict', field: 'expectedTotal',
      details: { reason: 'PRICE_CHANGED', oldTotal: 100_000, newTotal: 120_000 },
    });
    expect(payment.prepareCharge).toHaveBeenCalledExactlyOnceWith('user-1', 'order-1', input, { gatewayName: VNPAY_GATEWAY, buildKey: buildVnpayTxnRef });
    expect(payment.applyResult).not.toHaveBeenCalled();
    expect(orders.findPaymentsByKey).not.toHaveBeenCalled();
    expect(orders.insertPayment).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
  });

  it('còn lần trả đang chờ OTP thì báo xung đột, không huỷ hay tạo lần trả mới', async () => {
    const { useCases, orders, payment } = setup();
    const live: PaymentRecord = {
      id: 'payment-1', orderId: 'order-1', userId: 'user-1', gatewayKey: 'charge-1', amount: 100_000,
      status: 'requires_action', gateway: 'mock', gatewayRef: 'ref-1', failureCode: null,
      cardLast4: '1234', challengeId: 'challenge-1', checkAttempts: 0, createdAt: new Date('2026-11-12T00:00:00Z'),
    };
    payment.prepareCharge.mockResolvedValue({ kind: 'replay', payment: live });

    const result = useCases.startPayment('user-1', 'order-1', input);
    await expect(result).rejects.toBeInstanceOf(CommerceError);
    await expect(result).rejects.toMatchObject({
      code: 'conflict', field: undefined, details: undefined,
      message: 'Đơn này đang có một lần thanh toán chưa xong.',
    });
    expect(payment.prepareCharge).toHaveBeenCalledExactlyOnceWith('user-1', 'order-1', input, { gatewayName: VNPAY_GATEWAY, buildKey: buildVnpayTxnRef });
    expect(payment.applyResult).not.toHaveBeenCalled();
    expect(orders.findPaymentsByKey).not.toHaveBeenCalled();
    expect(orders.insertPayment).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    expect(live.status).toBe('requires_action');
  });
});
