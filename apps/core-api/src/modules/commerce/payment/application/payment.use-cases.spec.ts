import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { OutboxWriter } from '@tripflix/outbox';
import type { CheckoutUseCases } from '../../booking/application/checkout.use-cases.js';
import type { OrderItemRecord, OrderRecord, OrderStore, PaymentRecord, RefundRecord } from '../../booking/application/ports.js';
import { VNPAY_GATEWAY } from '../domain/vnpay-signature.js';
import type { PaymentGateway } from './gateway.port.js';
import { PaymentUseCases } from './payment.use-cases.js';
import { ACCEPTED_REFUND_REF, SUBMITTED_REFUND_REF, type RefundClient, type RefundOutcome, type RefundQueryOutcome } from './refund-gateways.port.js';

vi.mock('@tripflix/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tripflix/db')>()),
  Transactional: () => () => undefined,
}));

const NOW = new Date('2026-11-10T03:00:00Z');
const PAYMENT_DATE = new Date('2026-11-05T03:04:05Z');

function setup(options: { gateway?: string; isConfigured?: boolean; checkAttempts?: number; gatewayRef?: string | null } = {}) {
  const row: RefundRecord = {
    id: 'refund-1',
    orderId: 'order-1',
    paymentId: 'payment-1',
    gatewayKey: 'refund:cancel:order-1',
    amount: 600_000,
    status: 'initiated',
    needsReview: false,
    checkAttempts: options.checkAttempts ?? 0,
    parentRef: '15000001',
    parentGatewayKey: 'vnpaytxnref01',
    parentCreatedAt: PAYMENT_DATE,
    parentAmount: 1_000_000,
    gatewayRef: options.gatewayRef ?? null,
    gateway: options.gateway ?? VNPAY_GATEWAY,
  };
  let isDue = true;
  let needsReview = false;
  const client = {
    refund: vi.fn<RefundClient['refund']>().mockResolvedValue({ status: 'succeeded', ref: 'vnpay-refund-1' }),
    query: vi.fn<RefundClient['query']>().mockResolvedValue({ status: 'pending' }),
  };
  const gateway = {
    name: 'mock',
    charge: vi.fn<PaymentGateway['charge']>(),
    confirm3ds: vi.fn<PaymentGateway['confirm3ds']>(),
    lookup: vi.fn<PaymentGateway['lookup']>(),
    voidCharge: vi.fn<PaymentGateway['voidCharge']>(),
    refund: vi.fn<PaymentGateway['refund']>().mockResolvedValue({ ref: 'mock-refund-1' }),
  };
  const payment: PaymentRecord = {
    id: row.paymentId,
    orderId: row.orderId,
    userId: 'user-1',
    gatewayKey: row.parentGatewayKey,
    amount: row.parentAmount,
    status: 'succeeded',
    gateway: row.gateway,
    gatewayRef: row.parentRef,
    failureCode: null,
    cardLast4: null,
    challengeId: null,
    checkAttempts: 0,
    createdAt: PAYMENT_DATE,
  };
  const order: OrderRecord = {
    id: row.orderId,
    userId: payment.userId,
    status: 'paid',
    total: payment.amount,
    adults: 1,
    children: 0,
    infants: 0,
    sourcePostId: null,
    contactName: 'Nguyễn Văn An',
    contactPhone: '0901234567',
    contactEmail: null,
    holdExpiresAt: NOW,
    confirmationCode: 'ABC123',
    cancelReason: null,
    createdAt: PAYMENT_DATE,
    paidAt: PAYMENT_DATE,
  };
  const items: OrderItemRecord[] = [{
    id: 'item-1',
    orderId: row.orderId,
    productType: 'room',
    productId: 'room-1',
    productName: 'Phòng tiêu chuẩn',
    date: '2026-12-01',
    nights: 2,
    qty: 1,
    unitPrice: 500_000,
    childUnitPrice: null,
    infantUnitPrice: null,
    lineTotal: 1_000_000,
    ratePlanCode: 'RO',
    ratePlanName: 'Chỉ phòng',
    isRefundable: true,
    freeCancelUntil: '2026-11-28',
    confirmationCode: 'ABC123',
  }];
  const store = {
    findInitiatedRefunds: vi.fn<OrderStore['findInitiatedRefunds']>().mockImplementation(async (orderId) => row.status === 'initiated' && row.orderId === orderId ? [{ ...row }] : []),
    claimDueCharges: vi.fn<OrderStore['claimDueCharges']>().mockResolvedValue([]),
    claimDueRefunds: vi.fn<OrderStore['claimDueRefunds']>().mockImplementation(async (input) => {
      if (!isDue || needsReview || row.status !== 'initiated' || (input.orderId && input.orderId !== row.orderId)) return [];
      // Mô phỏng lease của store để hai tác vụ không cùng gửi một khoản hoàn.
      isDue = false;
      row.checkAttempts++;
      return [{ ...row }];
    }),
    findRefundsOfOrder: vi.fn<OrderStore['findRefundsOfOrder']>().mockImplementation(async () => [{ ...row }]),
    markRefundSucceeded: vi.fn<OrderStore['markRefundSucceeded']>().mockImplementation(async (_id, ref, metadata) => {
      row.status = 'succeeded';
      row.gatewayRef = ref;
      Object.assign(row, metadata);
    }),
    markRefundAccepted: vi.fn<OrderStore['markRefundAccepted']>().mockImplementation(async (_id, ref) => {
      if (row.status === 'initiated') row.gatewayRef = ref;
    }),
    markRefundSubmitted: vi.fn<OrderStore['markRefundSubmitted']>().mockImplementation(async (_id, ref, options) => {
      if (row.status !== 'initiated' || row.needsReview) return false;
      if (options ? row.gatewayRef !== options.expectedRef || row.checkAttempts !== options.checkAttempts : (ref === null ? row.gatewayRef !== SUBMITTED_REFUND_REF : row.gatewayRef !== null)) return false;
      row.gatewayRef = ref;
      return true;
    }),
    markForReview: vi.fn<OrderStore['markForReview']>().mockImplementation(async () => { needsReview = true; row.needsReview = true; }),
    lockOrder: vi.fn<OrderStore['lockOrder']>().mockResolvedValue(order),
    findItems: vi.fn<OrderStore['findItems']>().mockResolvedValue(items),
    findPaymentsOfOrder: vi.fn<OrderStore['findPaymentsOfOrder']>().mockResolvedValue([payment]),
    lockPaymentByKey: vi.fn<OrderStore['lockPaymentByKey']>().mockResolvedValue(payment),
    updatePayment: vi.fn<OrderStore['updatePayment']>().mockResolvedValue(undefined),
    unsellCell: vi.fn<OrderStore['unsellCell']>().mockResolvedValue(undefined),
    updateOrder: vi.fn<OrderStore['updateOrder']>().mockResolvedValue(undefined),
    insertRefund: vi.fn<OrderStore['insertRefund']>().mockImplementation(async (input) => {
      row.amount = input.amount;
      needsReview = input.needsReview;
      row.needsReview = input.needsReview;
      isDue = true;
    }),
  };
  const outbox = { add: vi.fn().mockResolvedValue(undefined) };
  const checkout = { getCheckout: vi.fn<CheckoutUseCases['getCheckout']>() };
  const registry = new Map<string, RefundClient>();
  if (options.isConfigured !== false) registry.set(VNPAY_GATEWAY, client);
  const restart = () => new PaymentUseCases(
    store as unknown as OrderStore,
    gateway,
    outbox as unknown as OutboxWriter,
    () => NOW,
    checkout as unknown as CheckoutUseCases,
    registry,
  );
  return { useCases: restart(), store, client, gateway, row, order, payment, outbox, checkout, restart, makeDue: () => { isDue = true; } };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('PaymentUseCases: định tuyến hoàn tiền', () => {
  it('VNPay thành công: ghi mã hoàn, chuyển đúng dữ liệu khoản trả gốc và không gọi cổng giả lập', async () => {
    const { useCases, store, client, gateway, row } = setup();

    expect(await useCases.processRefunds(row.orderId)).toBe(1);
    expect(client.refund).toHaveBeenCalledExactlyOnceWith({
      txnRef: row.parentGatewayKey,
      transactionNo: row.parentRef,
      transactionDate: PAYMENT_DATE,
      amount: 600_000,
      paidAmount: 1_000_000,
      requestId: expect.any(String),
    });
    expect(client.refund.mock.calls[0]![0].requestId.length).toBeGreaterThan(0);
    expect(store.markRefundSubmitted).toHaveBeenCalledExactlyOnceWith(row.id, SUBMITTED_REFUND_REF);
    expect(store.markRefundSubmitted.mock.invocationCallOrder[0]!).toBeLessThan(client.refund.mock.invocationCallOrder[0]!);
    expect(client.query).not.toHaveBeenCalled();
    expect(gateway.refund).not.toHaveBeenCalled();
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'vnpay-refund-1');
    expect(row.status).toBe('succeeded');
    expect(store.claimDueRefunds).toHaveBeenCalledWith(expect.objectContaining({
      orderId: row.orderId,
      olderThanSeconds: 0,
      limit: 100,
      backoffSeconds: [60, 120, 300, 900, 3600],
    }));
  });

  it('mã 94: giữ initiated và lưu dấu VNPay đã nhận để không gửi hoàn thêm', async () => {
    const { useCases, store, client, row } = setup();
    client.refund.mockResolvedValue({ status: 'pending' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
    expect(store.markRefundAccepted).toHaveBeenCalledExactlyOnceWith(row.id, ACCEPTED_REFUND_REF);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(store.markForReview).not.toHaveBeenCalled();
  });

  it('mã 95: chuyển khoản hoàn sang chờ người xử lý', async () => {
    const { useCases, store, client, row } = setup();
    client.refund.mockResolvedValue({ status: 'review' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
  });

  it('mất mạng: giữ khoản hoàn để job hỏi lại, có kết quả thì ghi nhận mà không gửi hoàn lần hai', async () => {
    const { useCases, store, client, row, makeDue } = setup();
    client.refund.mockRejectedValueOnce(new Error('network unavailable'));
    client.query.mockResolvedValue({ status: 'succeeded', ref: 'vnpay-recovered-1' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.status).toBe('initiated');
    expect(store.markForReview).not.toHaveBeenCalled();
    makeDue();
    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 1, errors: 0 });
    expect(client.refund).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'vnpay-recovered-1');
  });

  it('lỗi có thể thử lại: giữ initiated và không đánh dấu đã nhận', async () => {
    const { useCases, store, client, row } = setup();
    client.refund.mockResolvedValue({ status: 'retry' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBe(SUBMITTED_REFUND_REF);
    expect(store.markRefundAccepted).not.toHaveBeenCalled();
    expect(store.markForReview).not.toHaveBeenCalled();
  });

  it('thiếu cấu hình VNPay: chuyển chờ người xử lý và không gọi cổng', async () => {
    const { useCases, store, client, gateway, row } = setup({ isConfigured: false });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(client.refund).not.toHaveBeenCalled();
    expect(gateway.refund).not.toHaveBeenCalled();
  });

  it('cổng chưa biết: chuyển chờ người xử lý', async () => {
    const { useCases, store, client, gateway, row } = setup({ gateway: 'unsupported' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(client.refund).not.toHaveBeenCalled();
    expect(gateway.refund).not.toHaveBeenCalled();
  });

  it('cổng giả lập vẫn dùng phương thức hoàn hiện có', async () => {
    const { useCases, store, client, gateway, row } = setup({ gateway: 'mock' });

    expect(await useCases.processRefunds(row.orderId)).toBe(1);
    expect(gateway.refund).toHaveBeenCalledExactlyOnceWith({ ref: row.parentRef, amount: row.amount, gatewayKey: row.gatewayKey });
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'mock-refund-1');
    expect(client.refund).not.toHaveBeenCalled();
  });
});

describe('PaymentUseCases: đối soát hoàn VNPay an toàn', () => {
  it.each([ACCEPTED_REFUND_REF, SUBMITTED_REFUND_REF, `${SUBMITTED_REFUND_REF}:1`, null])('querydr không rõ kết quả: gửi lại cùng định danh khi ref=%s, mã 94 vẫn pending', async (gatewayRef) => {
    const { useCases, client, store, row } = setup({ checkAttempts: 1, gatewayRef });
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });
    client.refund.mockResolvedValue({ status: 'pending' });

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0, errors: 0 });
    expect(client.query).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ txnRef: row.parentGatewayKey, requestId: `${row.gatewayKey}:2` }));
    expect(client.refund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ txnRef: row.parentGatewayKey, requestId: row.gatewayKey }));
    expect(store.markRefundSubmitted).toHaveBeenCalledExactlyOnceWith(row.id, `${SUBMITTED_REFUND_REF}:2`, { expectedRef: gatewayRef, checkAttempts: 2 });
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(store.markForReview).not.toHaveBeenCalled();
  });

  it('querydr không rõ nhưng lượt claim đã cũ: CAS chặn gửi hoàn', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 1, gatewayRef: ACCEPTED_REFUND_REF });
    client.query.mockImplementation(async () => {
      row.checkAttempts++;
      return { status: 'retry', canResubmit: true };
    });
    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0 });
    expect(store.markRefundSubmitted).toHaveBeenCalledExactlyOnceWith(row.id, `${SUBMITTED_REFUND_REF}:2`, { expectedRef: ACCEPTED_REFUND_REF, checkAttempts: 2 });
    expect(client.refund).not.toHaveBeenCalled();
  });

  it('worker đang hỏi querydr thì khoản hoàn được chuyển review: CAS chặn gửi lại', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 1, gatewayRef: ACCEPTED_REFUND_REF });
    client.query.mockImplementation(async () => {
      row.needsReview = true;
      return { status: 'retry', canResubmit: true };
    });

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0, errors: 0 });
    expect(store.markRefundSubmitted).toHaveBeenCalledExactlyOnceWith(row.id, `${SUBMITTED_REFUND_REF}:2`, { expectedRef: ACCEPTED_REFUND_REF, checkAttempts: 2 });
    expect(client.refund).not.toHaveBeenCalled();
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(row.needsReview).toBe(true);
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
  });

  it('hai snapshot cùng lượt không được gửi fallback đồng thời', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 2, gatewayRef: ACCEPTED_REFUND_REF });
    store.claimDueRefunds.mockResolvedValue([{ ...row }]);
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });
    let resolveRefund!: (outcome: RefundOutcome) => void;
    client.refund.mockImplementation(() => new Promise<RefundOutcome>((resolve) => { resolveRefund = resolve; }));
    const first = useCases.reconcile(0);
    await vi.waitFor(() => expect(client.refund).toHaveBeenCalledTimes(1));
    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0 });
    expect(client.refund).toHaveBeenCalledTimes(1);
    resolveRefund({ status: 'pending' });
    expect(await first).toMatchObject({ refunds: 0 });
  });

  it.each(['refund', 'query'] as const)('%s thành công lưu ngân hàng và thời điểm VNPay', async (method) => {
    const { useCases, client, store, row } = setup({ checkAttempts: method === 'query' ? 1 : 0 });
    const metadata = { gatewayBankCode: 'NCB', gatewayRefundedAt: new Date('2026-11-10T04:22:33Z') };
    client[method].mockResolvedValue({ status: 'succeeded', ref: 'refund-123', ...metadata });
    expect(await useCases.processRefunds(row.orderId)).toBe(1);
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'refund-123', metadata);
  });

  it.each(['refund', 'query'] as const)('%s yêu cầu review: dừng tự động và không ghi thành công', async (method) => {
    const { useCases, client, store, row } = setup({ checkAttempts: method === 'query' ? 1 : 0 });
    client[method].mockResolvedValue({ status: 'review' });
    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
  });

  it('chưa lưu được dấu chuẩn bị gửi thì không gọi cổng', async () => {
    const { useCases, client, store, row } = setup();
    store.markRefundSubmitted.mockRejectedValueOnce(new Error('database unavailable'));

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(client.refund).not.toHaveBeenCalled();
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBeNull();
  });

  it('lease cũ hết hạn: snapshot chưa có submitted vẫn phải thắng phép ghi nguyên tử rồi mới gọi cổng', async () => {
    const { useCases, client, store, row } = setup();
    store.claimDueRefunds.mockResolvedValueOnce([{ ...row, checkAttempts: 1 }]).mockResolvedValueOnce([{ ...row, checkAttempts: 2 }]);
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });
    let resolveRefund!: (outcome: RefundOutcome) => void;
    client.refund.mockImplementation(() => new Promise<RefundOutcome>((resolve) => { resolveRefund = resolve; }));

    const first = useCases.processRefunds(row.orderId);
    await vi.waitFor(() => expect(client.refund).toHaveBeenCalledTimes(1));
    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(store.markRefundSubmitted).toHaveBeenCalledTimes(2);
    await expect(store.markRefundSubmitted.mock.results[1]!.value).resolves.toBe(false);
    expect(client.refund).toHaveBeenCalledTimes(1);
    resolveRefund({ status: 'succeeded', ref: 'vnpay-refund-1' });
    expect(await first).toBe(1);
  });

  it.each(['mất phản hồi mạng', 'lỗi ghi thành công vào database'])('%s rồi khởi động lại: querydr pay01 gửi lại cùng định danh, mã 94 vẫn pending', async (failure) => {
    const { useCases, client, store, row, makeDue, restart } = setup();
    if (failure === 'mất phản hồi mạng') client.refund.mockRejectedValueOnce(new Error('network unavailable'));
    else store.markRefundSucceeded.mockRejectedValueOnce(new Error('database unavailable'));
    client.query.mockResolvedValueOnce({ status: 'retry', canResubmit: true }).mockResolvedValueOnce({ status: 'succeeded', ref: 'vnpay-refund-1' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.gatewayRef).toBe(SUBMITTED_REFUND_REF);
    const initialRequestId = client.refund.mock.calls[0]![0].requestId;
    client.refund.mockResolvedValue({ status: 'pending' });
    store.markRefundSucceeded.mockClear();
    const restarted = restart();
    makeDue();
    expect(await restarted.reconcile(0)).toMatchObject({ refunds: 0 });
    expect(row.status).toBe('initiated');
    expect(client.refund).toHaveBeenCalledTimes(2);
    expect(client.refund.mock.calls[1]![0].requestId).toBe(initialRequestId);
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);

    makeDue();
    expect(await restarted.reconcile(0)).toMatchObject({ refunds: 1 });
    expect(row.status).toBe('succeeded');
    expect(client.refund).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'vnpay-refund-1');
  });

  it('phản hồi có chữ ký xác nhận chưa xử lý: xoá dấu submitted để lần đối soát được gửi lại', async () => {
    const { useCases, client, store, row, makeDue } = setup();
    client.refund.mockResolvedValueOnce({ status: 'retry', canResubmit: true }).mockResolvedValueOnce({ status: 'succeeded', ref: 'vnpay-refund-1' });
    client.query.mockResolvedValueOnce({ status: 'retry', canResubmit: true });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.gatewayRef).toBeNull();
    expect(store.markRefundSubmitted).toHaveBeenNthCalledWith(1, row.id, SUBMITTED_REFUND_REF);
    expect(store.markRefundSubmitted).toHaveBeenNthCalledWith(2, row.id, null);

    makeDue();
    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 1 });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.refund).toHaveBeenCalledTimes(2);
    expect(store.markRefundSubmitted).toHaveBeenNthCalledWith(3, row.id, `${SUBMITTED_REFUND_REF}:2`, { expectedRef: null, checkAttempts: 2 });
    expect(row.status).toBe('succeeded');
  });

  it('querydr chỉ thấy giao dịch trả: gửi lại khi chưa từng có dấu đã nhận', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 1 });
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 1, errors: 0 });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.refund).toHaveBeenCalledTimes(1);
    expect(store.markRefundSucceeded).toHaveBeenCalledExactlyOnceWith(row.id, 'vnpay-refund-1');
  });

  it('querydr chỉ thấy giao dịch trả sau khi VNPay đã nhận: gửi lại cùng định danh, mã 94 vẫn pending', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 1, gatewayRef: ACCEPTED_REFUND_REF });
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });
    client.refund.mockResolvedValue({ status: 'pending' });

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0 });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.refund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: row.gatewayKey }));
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(store.markForReview).not.toHaveBeenCalled();
  });

  it('VNPay còn xử lý qua nhiều lần job: luôn querydr và không gửi lại khoản đã nhận', async () => {
    const { useCases, client, row, makeDue } = setup();
    client.refund.mockResolvedValue({ status: 'pending' });
    await useCases.processRefunds(row.orderId);

    for (let attempt = 0; attempt < 3; attempt++) {
      makeDue();
      expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0 });
    }
    expect(row.status).toBe('initiated');
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
    expect(client.refund).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('cổng hoàn thành nhưng ghi database lỗi: job hỏi kết quả để khôi phục, không gửi lại', async () => {
    const { useCases, client, store, row, makeDue } = setup();
    store.markRefundSucceeded.mockRejectedValueOnce(new Error('database unavailable'));
    client.query.mockResolvedValue({ status: 'succeeded', ref: 'vnpay-refund-1' });

    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(row.status).toBe('initiated');
    makeDue();
    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 1 });
    expect(client.refund).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('succeeded');
  });

  it.each<RefundQueryOutcome>([{ status: 'pending' }, { status: 'retry' }])('quá 30 lần còn $status: chuyển người xử lý', async (outcome) => {
    const { useCases, client, store, row } = setup({ checkAttempts: 29 });
    client.query.mockResolvedValue(outcome);

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0 });
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(client.refund).not.toHaveBeenCalled();
  });

  it('lượt 30 querydr không rõ rồi gửi lại nhận mã 94: giữ initiated và chuyển review', async () => {
    const { useCases, client, store, row } = setup({ checkAttempts: 29, gatewayRef: ACCEPTED_REFUND_REF });
    client.query.mockResolvedValue({ status: 'retry', canResubmit: true });
    client.refund.mockResolvedValue({ status: 'pending' });

    expect(await useCases.reconcile(0)).toMatchObject({ refunds: 0, errors: 0 });
    expect(client.query).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: `${row.gatewayKey}:30` }));
    expect(client.refund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: row.gatewayKey }));
    expect(store.markRefundSubmitted).toHaveBeenCalledExactlyOnceWith(row.id, `${SUBMITTED_REFUND_REF}:30`, { expectedRef: ACCEPTED_REFUND_REF, checkAttempts: 30 });
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(store.markRefundSucceeded).not.toHaveBeenCalled();
    expect(row.status).toBe('initiated');
    expect(row.needsReview).toBe(true);
    expect(row.gatewayRef).toBe(ACCEPTED_REFUND_REF);
  });

  it('hai processRefunds chạy trùng: lease chỉ cho một lần gọi cổng; gọi lại sau thành công không hoàn nữa', async () => {
    const { useCases, client, row, makeDue } = setup();
    let resolveRefund!: (outcome: RefundOutcome) => void;
    client.refund.mockImplementation(() => new Promise<RefundOutcome>((resolve) => { resolveRefund = resolve; }));

    const first = useCases.processRefunds(row.orderId);
    await vi.waitFor(() => expect(client.refund).toHaveBeenCalledTimes(1));
    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    resolveRefund({ status: 'succeeded', ref: 'vnpay-refund-1' });
    expect(await first).toBe(1);
    makeDue();
    expect(await useCases.processRefunds(row.orderId)).toBe(0);
    expect(client.refund).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentUseCases: ghi ý định hoàn cho VNPay đã cấu hình', () => {
  it('pay được gọi lại sau thành công: trả ngân hàng và thời điểm VNPay đã lưu', async () => {
    const { useCases, checkout, gateway, client, payment, order } = setup();
    payment.gatewayBankCode = 'VCB';
    payment.gatewayPaidAt = PAYMENT_DATE;
    vi.spyOn(useCases, 'prepareCharge').mockResolvedValue({ kind: 'replay', payment });
    checkout.getCheckout.mockResolvedValue({ confirmationCode: order.confirmationCode } as Awaited<ReturnType<CheckoutUseCases['getCheckout']>>);

    expect(await useCases.pay(order.userId, order.id, { paymentToken: 'unused-replay-token', expectedTotal: order.total, acceptedPolicyVersion: 'unused-replay-policy' }))
      .toMatchObject({ outcome: 'paid', orderId: order.id, confirmationCode: order.confirmationCode, bankCode: 'VCB', paidAt: PAYMENT_DATE.toISOString() });
    expect(checkout.getCheckout).toHaveBeenCalledExactlyOnceWith(order.userId, order.id);
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(client.refund).not.toHaveBeenCalled();
  });

  it('huỷ đã hoàn: trả metadata ngân hàng và thời gian bằng các trường optional hiện có', async () => {
    const { useCases, client, order } = setup();
    client.refund.mockResolvedValue({ status: 'succeeded', ref: 'refund-123', gatewayBankCode: 'NCB', gatewayRefundedAt: NOW });
    expect(await useCases.cancelPaid(order.userId, order.id)).toMatchObject({ refundStatus: 'refunded', bankCode: 'NCB', refundedAt: NOW.toISOString() });
  });

  it('khoản hoàn khác đã xong nhưng hoàn huỷ còn pending: vẫn processing và không lấy nhầm metadata', async () => {
    const { useCases, store, order, row } = setup();
    vi.spyOn(useCases, 'processRefunds').mockResolvedValue(1);
    store.findRefundsOfOrder.mockImplementation(async () => [{
      ...row,
      id: 'refund-unrelated',
      gatewayKey: 'refund:late:order-1',
      status: 'succeeded',
      gatewayBankCode: 'VCB',
      gatewayRefundedAt: NOW,
    }, { ...row }]);

    const cancelled = await useCases.cancelPaid(order.userId, order.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', refundStatus: 'processing' });
    expect(cancelled).not.toHaveProperty('bankCode');
    expect(cancelled).not.toHaveProperty('refundedAt');
    expect(row.status).toBe('initiated');
  });

  it.each(['initiated', 'failed'] as const)('pay thành công từ %s: lưu metadata trong applyResult và không gọi mạng', async (status) => {
    const { useCases, store, client, payment, order } = setup();
    payment.status = status;
    order.status = 'expired';
    const metadata = { gatewayBankCode: 'VCB', gatewayPaidAt: PAYMENT_DATE };
    expect(await useCases.applyResult(payment.gatewayKey, { status: 'succeeded', ref: 'pay-123', ...metadata })).toEqual({ kind: 'compensated' });
    expect(store.updatePayment).toHaveBeenCalledWith(payment.id, expect.objectContaining(metadata));
    expect(client.refund).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('huỷ đơn đã trả: khoản hoàn tự động không bị gắn cờ xử lý thủ công', async () => {
    const { useCases, store, client, order } = setup();
    client.refund.mockResolvedValue({ status: 'pending' });

    expect(await useCases.cancelPaid(order.userId, order.id)).toMatchObject({ status: 'cancelled', refundStatus: 'processing' });
    expect(store.insertRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'payment-1', needsReview: false }));
    expect(client.refund).toHaveBeenCalledTimes(1);
  });

  it('huỷ đơn gặp mã 95: trả needs_review ngay khi cổng từ chối khoản hoàn', async () => {
    const { useCases, store, client, order, row } = setup();
    client.refund.mockResolvedValue({ status: 'review' });

    expect(await useCases.cancelPaid(order.userId, order.id)).toMatchObject({ status: 'cancelled', refundStatus: 'needs_review' });
    expect(store.markForReview).toHaveBeenCalledExactlyOnceWith('refund', row.id);
    expect(row.needsReview).toBe(true);
    expect(row.status).toBe('initiated');
  });

  it('huỷ đơn khi thiếu cấu hình VNPay: trả needs_review và không gọi cổng', async () => {
    const { useCases, store, client, gateway, order } = setup({ isConfigured: false });

    expect(await useCases.cancelPaid(order.userId, order.id)).toMatchObject({ status: 'cancelled', refundStatus: 'needs_review' });
    expect(store.insertRefund).toHaveBeenCalledWith(expect.objectContaining({ needsReview: true }));
    expect(client.refund).not.toHaveBeenCalled();
    expect(gateway.refund).not.toHaveBeenCalled();
  });

  it('tiền về muộn: chỉ ghi ý định hoàn trong applyResult, không gọi mạng trong transaction', async () => {
    const { useCases, store, client, payment, order } = setup();
    payment.status = 'failed';
    order.status = 'expired';

    expect(await useCases.applyResult(payment.gatewayKey, { status: 'succeeded', ref: '15000002' })).toEqual({ kind: 'compensated' });
    expect(store.insertRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: payment.id, needsReview: false }));
    expect(client.refund).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
