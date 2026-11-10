import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import type { OrderStore, PaymentRecord } from '../../booking/application/ports.js';
import { buildVnpayRefundRequest } from '../domain/vnpay-merchant-api.js';
import { VNPAY_GATEWAY } from '../domain/vnpay-signature.js';
import { buildSignData } from '../domain/vnpay-signature.js';
import { describeVnpayPayError } from '../domain/vnpay-pay-error.js';
import type { PaymentUseCases } from './payment.use-cases.js';
import { VnpayUseCases, type VnpayConfig } from './vnpay.use-cases.js';

vi.mock('@tripflix/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tripflix/db')>()),
  Transactional: () => () => undefined,
}));

const config: VnpayConfig = {
  tmnCode: 'TESTCODE',
  hashSecret: 'test-merchant-secret',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'https://tripflix.example/payment/return',
};
const payInput = { expectedTotal: 100000, acceptedPolicyVersion: 'policy-1', clientIp: '127.0.0.1' };

function setup(createdAt: Date) {
  const payment: PaymentRecord = {
    id: 'payment-1', orderId: 'order-1', userId: 'user-1', gatewayKey: 'TXN01', amount: 100000,
    status: 'initiated', gateway: VNPAY_GATEWAY, gatewayRef: null, failureCode: null,
    cardLast4: null, challengeId: null, checkAttempts: 0, createdAt,
  };
  const store = { findPaymentsByKey: vi.fn<OrderStore['findPaymentsByKey']>().mockResolvedValue([payment]) };
  const preparation = { prepareCharge: vi.fn<PaymentUseCases['prepareCharge']>().mockResolvedValue({ kind: 'charge', gatewayKey: 'TXN01', amount: 100000 }) };
  const useCases = new VnpayUseCases(config, store as unknown as OrderStore, preparation as unknown as PaymentUseCases);
  return { useCases, store, preparation, payment };
}

afterEach(() => vi.useRealTimers());

describe('VnpayUseCases: ngày giao dịch được lưu', () => {
  it.each([
    ['2026-11-10T03:04:05.999Z', '2026-11-10T03:04:06.001Z', '20261110100405', '2026-11-10T03:19:06.001Z'],
    ['2026-11-10T16:59:59.999Z', '2026-11-10T17:00:00.001Z', '20261110235959', '2026-11-10T17:15:00.001Z'],
  ])('giữ CreateDate từ khoản đã lưu khi đồng hồ đi từ %s tới %s', async (savedAt, now, expectedCreateDate, expectedExpiresAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { useCases, store, preparation } = setup(new Date(savedAt));

    const result = await useCases.startPayment('user-1', 'order-1', payInput);

    expect(new URL(result.paymentUrl).searchParams.get('vnp_CreateDate')).toBe(expectedCreateDate);
    expect(result.expiresAt).toBe(expectedExpiresAt);
    expect(store.findPaymentsByKey).toHaveBeenCalledExactlyOnceWith('TXN01');
    expect(preparation.prepareCharge.mock.invocationCallOrder[0]!).toBeLessThan(store.findPaymentsByKey.mock.invocationCallOrder[0]!);
  });

  it('Merchant API hoàn về sau dùng đúng TransactionDate bằng CreateDate của URL thanh toán', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T17:00:00.001Z'));
    const { useCases, payment } = setup(new Date('2026-11-10T16:59:59.999Z'));
    const result = await useCases.startPayment('user-1', 'order-1', payInput);

    vi.setSystemTime(new Date('2026-11-20T03:04:05Z'));
    const refundRequest = buildVnpayRefundRequest({
      tmnCode: config.tmnCode, hashSecret: config.hashSecret, txnRef: payment.gatewayKey,
      transactionNo: '123456', transactionDate: payment.createdAt, amount: 50000,
      paidAmount: payment.amount, requestId: 'REFUND01', now: new Date(),
    });

    expect(refundRequest.vnp_TransactionDate).toBe(new URL(result.paymentUrl).searchParams.get('vnp_CreateDate'));
    expect(refundRequest.vnp_TransactionDate).toBe('20261110235959');
    expect(refundRequest.vnp_CreateDate).toBe('20261120100405');
  });

  it('không trả URL khi không đọc lại được khoản thanh toán vừa lưu', async () => {
    const { useCases, store } = setup(new Date('2026-11-10T03:04:05Z'));
    store.findPaymentsByKey.mockResolvedValue([]);

    await expect(useCases.startPayment('user-1', 'order-1', payInput)).rejects.toThrow('Không tìm thấy khoản thanh toán vừa tạo.');
  });
});

describe('VnpayUseCases: callback metadata và thông điệp thất bại', () => {
  function setupCallback() {
    const context = setup(new Date('2026-11-10T03:04:05Z'));
    const store = {
      ...context.store,
      findOrder: vi.fn<OrderStore['findOrder']>().mockResolvedValue({ status: 'paid' } as Awaited<ReturnType<OrderStore['findOrder']>>),
    };
    const payment = {
      applyResult: vi.fn<PaymentUseCases['applyResult']>().mockImplementation(async (_key, result) => {
        if (result.status === 'succeeded') context.payment.status = 'succeeded';
        return result.status === 'succeeded' ? { kind: 'paid' } : { kind: 'failed', code: result.code!, message: result.message };
      }),
      processRefunds: vi.fn<PaymentUseCases['processRefunds']>(),
    };
    return { ...context, store, paymentUseCases: payment, useCases: new VnpayUseCases(config, store as unknown as OrderStore, payment as unknown as PaymentUseCases) };
  }

  function signCallback(overrides: Record<string, string> = {}): Record<string, string> {
    const params = {
      vnp_TxnRef: 'TXN01', vnp_Amount: '10000000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
      vnp_TransactionNo: '123456', vnp_BankCode: 'VCB', vnp_PayDate: '20261110000102', ...overrides,
    };
    return { ...params, vnp_SecureHash: createHmac('sha512', config.hashSecret).update(buildSignData(params), 'utf8').digest('hex') };
  }

  it.each(['handleIpn', 'handleReturn'] as const)('%s thành công chuyển metadata vào cùng TX2 ghi mã giao dịch', async (method) => {
    const { useCases, paymentUseCases } = setupCallback();
    await useCases[method](signCallback());
    expect(paymentUseCases.applyResult).toHaveBeenCalledExactlyOnceWith('TXN01', expect.objectContaining({
      status: 'succeeded', ref: '123456', gatewayBankCode: 'VCB', gatewayPaidAt: new Date('2026-11-09T17:01:02Z'),
    }));
  });

  it('callback thành công thiếu metadata vẫn áp dụng và dùng null cho dữ liệu không có', async () => {
    const { useCases, paymentUseCases } = setupCallback();
    await useCases.handleIpn(signCallback({ vnp_BankCode: '', vnp_PayDate: '20260230000102' }));
    expect(paymentUseCases.applyResult).toHaveBeenCalledWith('TXN01', expect.objectContaining({ status: 'succeeded', gatewayBankCode: null, gatewayPaidAt: null }));
  });

  it.each(['07', '09', '10', '11', '12', '13', '24', '51', '65', '75', '79', '99', 'unknown'])('pay mã %s giữ failure code và chuyển thông điệp tiếng Việt qua ChargeResult.message', async (code) => {
    const { useCases, paymentUseCases } = setupCallback();
    await useCases.handleIpn(signCallback({ vnp_ResponseCode: code, vnp_TransactionStatus: '02' }));
    expect(paymentUseCases.applyResult).toHaveBeenCalledWith('TXN01', expect.objectContaining({ status: 'failed', code: `vnpay_${code}`, message: describeVnpayPayError(code) }));
    const result = paymentUseCases.applyResult.mock.calls[0]![1];
    expect(result).not.toHaveProperty('gatewayPaidAt');
    expect(result).not.toHaveProperty('gatewayBankCode');
  });

  it('callback sai chữ ký không ghi metadata', async () => {
    const { useCases, paymentUseCases } = setupCallback();
    expect(await useCases.handleIpn({ ...signCallback(), vnp_BankCode: 'NCB' })).toMatchObject({ RspCode: '97' });
    expect(paymentUseCases.applyResult).not.toHaveBeenCalled();
  });
});
