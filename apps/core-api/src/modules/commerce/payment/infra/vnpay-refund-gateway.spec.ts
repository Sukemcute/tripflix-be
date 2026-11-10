import { createHmac } from 'node:crypto';
import type { RefundInput } from '../application/refund-gateways.port.js';
import type { VnpayConfig } from '../application/vnpay.use-cases.js';
import { VNPAY_DEFAULT_API_URL, VnpayRefundClient } from './vnpay-refund-gateway.js';

const CONFIG: VnpayConfig = {
  tmnCode: 'TESTCODE',
  hashSecret: 'test-merchant-secret',
  paymentUrl: 'https://pay.example.test',
  returnUrl: 'https://return.example.test',
  apiUrl: 'https://merchant.example.test/transaction',
};
const INPUT: RefundInput = {
  txnRef: 'PAYMENT01',
  transactionNo: 'PAY123456',
  transactionDate: new Date('2026-11-05T03:04:05Z'),
  amount: 125_000,
  paidAmount: 250_000,
  requestId: 'refund-order-123-0',
};
const RESPONSE_FIELDS = [
  'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message',
  'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate',
  'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo',
];
const decimalCodes = Array.from({ length: 100 }, (_, code) => String(code).padStart(2, '0'));
const successfulOutcome = {
  status: 'succeeded', ref: 'REFUND987654', gatewayBankCode: 'NCB',
  gatewayRefundedAt: new Date('2026-11-10T04:22:33Z'),
};
const refundCodeOutcomes: Readonly<Record<string, object>> = {
  '00': successfulOutcome, '02': { status: 'retry', canResubmit: true },
  '03': { status: 'retry', canResubmit: true }, '94': { status: 'pending' },
  '97': { status: 'retry', canResubmit: true }, '99': { status: 'retry' },
};
const queryCodeOutcomes: Readonly<Record<string, object>> = {
  '00': successfulOutcome, '02': { status: 'retry' }, '03': { status: 'retry' },
  '91': { status: 'retry', canResubmit: true }, '94': { status: 'retry' },
  '97': { status: 'retry' }, '99': { status: 'retry', canResubmit: true },
};
const refundStatusOutcomes: Readonly<Record<string, object>> = {
  '00': successfulOutcome, '05': { status: 'pending' }, '06': { status: 'pending' },
};

function signResponse(command: 'refund' | 'querydr', overrides: Record<string, string> = {}): Record<string, string> {
  const response: Record<string, string> = {
    vnp_ResponseId: 'RESPONSE123',
    vnp_Command: command,
    vnp_ResponseCode: '00',
    vnp_Message: 'Thanh cong',
    vnp_TmnCode: CONFIG.tmnCode,
    vnp_TxnRef: INPUT.txnRef,
    vnp_Amount: '12500000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261110112233',
    vnp_TransactionNo: 'REFUND987654',
    vnp_TransactionType: '03',
    vnp_TransactionStatus: '00',
    vnp_OrderInfo: 'Hoan tien don hang',
    ...(command === 'querydr' ? { vnp_PromotionCode: '', vnp_PromotionAmount: '' } : {}),
    ...overrides,
  };
  // Tự ký theo đặc tả để test không lặp lại lỗi của bộ ký trong production.
  const fields = command === 'querydr' ? [...RESPONSE_FIELDS, 'vnp_PromotionCode', 'vnp_PromotionAmount'] : RESPONSE_FIELDS;
  response.vnp_SecureHash = createHmac('sha512', CONFIG.hashSecret)
    .update(fields.map((field) => response[field] ?? '').join('|'))
    .digest('hex');
  return response;
}

describe('VnpayRefundClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let client: VnpayRefundClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T04:22:33Z'));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    client = new VnpayRefundClient(CONFIG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function respond(body: unknown, status = 200): void {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  function getRequest(): { url: RequestInfo | URL; options: RequestInit; body: Record<string, string> } {
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(options).toBeDefined();
    return { url, options: options!, body: JSON.parse(options!.body as string) as Record<string, string> };
  }

  it('gửi refund JSON đã ký, dùng dữ liệu giao dịch gốc và timeout', async () => {
    respond(signResponse('refund'));

    await expect(client.refund(INPUT)).resolves.toEqual(successfulOutcome);

    const { url, options, body } = getRequest();
    expect(url).toBe(CONFIG.apiUrl);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(Object.values(body).every((value) => typeof value === 'string')).toBe(true);
    expect(body).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: CONFIG.tmnCode,
      vnp_TransactionType: '03',
      vnp_TxnRef: INPUT.txnRef,
      vnp_Amount: '12500000',
      vnp_TransactionNo: INPUT.transactionNo,
      vnp_TransactionDate: '20261105100405',
      vnp_CreateDate: '20261110112233',
      vnp_CreateBy: 'tripflix-system',
      vnp_IpAddr: '127.0.0.1',
    });
    expect(body.vnp_RequestId).toMatch(/^[A-Za-z0-9]{1,32}$/);
    const fields = [
      'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TransactionType',
      'vnp_TxnRef', 'vnp_Amount', 'vnp_TransactionNo', 'vnp_TransactionDate',
      'vnp_CreateBy', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
    ];
    expect(body.vnp_SecureHash).toBe(createHmac('sha512', CONFIG.hashSecret)
      .update(fields.map((field) => body[field] ?? '').join('|')).digest('hex'));
  });

  it('hoàn toàn bộ dùng loại 02 và URL sandbox mặc định khi chưa cấu hình API URL', async () => {
    const { apiUrl: _apiUrl, ...defaultConfig } = CONFIG;
    client = new VnpayRefundClient(defaultConfig);
    respond(signResponse('refund', { vnp_Amount: '25000000', vnp_TransactionType: '02' }));

    await expect(client.refund({ ...INPUT, amount: INPUT.paidAmount })).resolves.toEqual(successfulOutcome);
    expect(getRequest().url).toBe(VNPAY_DEFAULT_API_URL);
    expect(getRequest().body).toMatchObject({ vnp_TransactionType: '02', vnp_Amount: '25000000' });
  });

  it('request ID giữ nguyên cho cùng refund kể cả khi đối soát sang ngày mới', async () => {
    respond(signResponse('refund', { vnp_ResponseCode: '94' }));
    await client.refund(INPUT);
    const firstRequestId = getRequest().body.vnp_RequestId;
    await client.refund(INPUT);
    const sameDayBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as Record<string, string>;
    expect(sameDayBody.vnp_RequestId).toBe(firstRequestId);

    vi.setSystemTime(new Date('2026-11-11T04:22:33Z'));
    await client.refund(INPUT);
    const nextDayBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as Record<string, string>;
    expect(nextDayBody.vnp_RequestId).toBe(firstRequestId);
    expect(nextDayBody.vnp_CreateDate).not.toBe(sameDayBody.vnp_CreateDate);
  });

  it('querydr dùng mã khác cho lượt tra cứu tiếp theo và khi sang ngày mới', async () => {
    respond(signResponse('querydr', { vnp_ResponseCode: '94' }));
    await client.query(INPUT);
    const firstRequestId = getRequest().body.vnp_RequestId;
    await client.query({ ...INPUT, requestId: `${INPUT.requestId}:2` });
    const nextAttemptBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as Record<string, string>;
    expect(nextAttemptBody.vnp_RequestId).not.toBe(firstRequestId);

    vi.setSystemTime(new Date('2026-11-11T04:22:33Z'));
    await client.query(INPUT);
    const nextDayBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as Record<string, string>;
    expect(nextDayBody.vnp_RequestId).not.toBe(firstRequestId);
  });

  it('giao dịch không có mã VNPay vẫn gửi TransactionNo dưới dạng chuỗi', async () => {
    respond(signResponse('refund'));
    await client.refund({ ...INPUT, transactionNo: null });
    expect(getRequest().body.vnp_TransactionNo).toBe('');
  });

  it.each([
    ['94', 'pending'],
    ['95', 'review'],
    ['91', 'review'],
    ['99', 'retry'],
  ] as const)('refund mã %s trả về %s', async (code, status) => {
    respond(signResponse('refund', { vnp_ResponseCode: code }));
    const outcome = await client.refund(INPUT);
    expect(outcome).toEqual({ status });
    if (code === '99') expect(outcome).not.toHaveProperty('canResubmit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(decimalCodes)('refund mã phản hồi %s đã ký vào đúng nhóm và quyền gửi lại', async (code) => {
    respond(signResponse('refund', { vnp_ResponseCode: code }));
    await expect(client.refund(INPUT)).resolves.toEqual(refundCodeOutcomes[code] ?? { status: 'review' });
  });

  it.each(decimalCodes)('querydr mã phản hồi %s đã ký vào đúng nhóm và quyền gửi lại', async (code) => {
    respond(signResponse('querydr', { vnp_ResponseCode: code }));
    await expect(client.query(INPUT)).resolves.toEqual(queryCodeOutcomes[code] ?? { status: 'review' });
  });

  it.each(decimalCodes)('refund mã 00 dùng trạng thái %s để xác nhận tiền hoàn', async (status) => {
    respond(signResponse('refund', { vnp_TransactionStatus: status }));
    await expect(client.refund(INPUT)).resolves.toEqual(refundStatusOutcomes[status] ?? { status: 'review' });
  });

  it.each(decimalCodes)('querydr mã 00 dùng trạng thái %s của giao dịch hoàn', async (status) => {
    respond(signResponse('querydr', { vnp_TransactionStatus: status }));
    await expect(client.query(INPUT)).resolves.toEqual(refundStatusOutcomes[status] ?? { status: 'review' });
  });

  it.each(['', '0', '100', 'unknown'])('mã phản hồi không rõ %j không cho phép gửi lại', async (code) => {
    for (const method of ['refund', 'query'] as const) {
      respond(signResponse(method === 'refund' ? 'refund' : 'querydr', { vnp_ResponseCode: code }));
      await expect(client[method](INPUT)).resolves.toEqual({ status: 'review' });
    }
  });

  it.each(['', '0', '100', 'unknown'])('trạng thái không rõ %j không cho phép gửi lại', async (status) => {
    for (const method of ['refund', 'query'] as const) {
      respond(signResponse(method === 'refund' ? 'refund' : 'querydr', { vnp_TransactionStatus: status }));
      await expect(client[method](INPUT)).resolves.toEqual({ status: 'review' });
    }
  });

  it.each(['vnp_ResponseCode', 'vnp_TransactionStatus'])('phản hồi đã ký thiếu %s cần người kiểm tra', async (field) => {
    for (const method of ['refund', 'query'] as const) {
      const response = signResponse(method === 'refund' ? 'refund' : 'querydr', { [field]: '' });
      delete response[field];
      respond(response);
      await expect(client[method](INPUT)).resolves.toEqual({ status: 'review' });
    }
  });

  it.each(['02', '03', '97'])('refund mã %s đã xác thực cho phép gửi lại vì chưa được xử lý', async (code) => {
    respond(signResponse('refund', { vnp_ResponseCode: code }));
    await expect(client.refund(INPUT)).resolves.toEqual({ status: 'retry', canResubmit: true });
  });

  it.each(['02', '03', '97'])('refund mã %s chữ ký sai không cho phép gửi lại', async (code) => {
    respond({ ...signResponse('refund', { vnp_ResponseCode: code }), vnp_SecureHash: '0'.repeat(128) });
    const outcome = await client.refund(INPUT);
    expect(outcome).toEqual({ status: 'retry' });
    expect(outcome).not.toHaveProperty('canResubmit');
  });

  it.each(['02', '03', '97'])('refund mã %s sai giao dịch gốc không cho phép gửi lại', async (code) => {
    respond(signResponse('refund', { vnp_ResponseCode: code, vnp_TxnRef: 'ANOTHERPAY' }));
    await expect(client.refund(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each([
    ['mã merchant', { vnp_TmnCode: 'ANOTHER' }],
    ['mã giao dịch gốc', { vnp_TxnRef: 'ANOTHERPAY' }],
    ['command', { vnp_Command: 'querydr' }],
    ['số tiền', { vnp_Amount: '25000000' }],
    ['loại hoàn', { vnp_TransactionType: '02' }],
    ['mã giao dịch hoàn rỗng', { vnp_TransactionNo: '' }],
  ])('không ghi thành công khi response đã ký có %s không khớp', async (_label, overrides) => {
    respond(signResponse('refund', overrides));
    await expect(client.refund(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it('không ghi thành công khi response thiếu mã giao dịch hoàn', async () => {
    const response = signResponse('refund', { vnp_TransactionNo: '' });
    delete response.vnp_TransactionNo;
    respond(response);
    await expect(client.refund(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['refund', 'query'] as const)('%s chữ ký sai để lại cho đối soát', async (method) => {
    respond({ ...signResponse(method === 'refund' ? 'refund' : 'querydr'), vnp_SecureHash: '0'.repeat(128) });
    const outcome = await client[method](INPUT);
    expect(outcome).toEqual({ status: 'retry' });
    expect(outcome).not.toHaveProperty('canResubmit');
  });

  it.each(['refund', 'query'] as const)('%s lỗi mạng để lại cho đối soát', async (method) => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client[method](INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['refund', 'query'] as const)('%s timeout để lại cho đối soát', async (method) => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    await expect(client[method](INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['refund', 'query'] as const)('%s HTTP lỗi không được coi là thành công', async (method) => {
    respond(signResponse(method === 'refund' ? 'refund' : 'querydr'), 503);
    await expect(client[method](INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['refund', 'query'] as const)('%s JSON lỗi không được coi là thành công', async (method) => {
    fetchMock.mockResolvedValue(new Response('invalid json'));
    await expect(client[method](INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each([
    ['số', { vnp_Amount: 12500000 }],
    ['null', null],
    ['mảng', []],
  ])('response có giá trị %s không hợp lệ trả retry', async (_label, body) => {
    respond(body);
    await expect(client.refund(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it('querydr gửi ngày thanh toán gốc với checksum riêng và trả mã giao dịch hoàn', async () => {
    respond(signResponse('querydr'));
    await expect(client.query(INPUT)).resolves.toEqual(successfulOutcome);

    const { body } = getRequest();
    expect(body).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: CONFIG.tmnCode,
      vnp_TxnRef: INPUT.txnRef,
      vnp_TransactionNo: INPUT.transactionNo,
      vnp_TransactionDate: '20261105100405',
      vnp_CreateDate: '20261110112233',
      vnp_IpAddr: '127.0.0.1',
    });
    expect(Object.values(body).every((value) => typeof value === 'string')).toBe(true);
    const fields = [
      'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef',
      'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
    ];
    expect(body.vnp_SecureHash).toBe(createHmac('sha512', CONFIG.hashSecret)
      .update(fields.map((field) => body[field] ?? '').join('|')).digest('hex'));
  });

  it.each(['05', '06'])('querydr hoàn đang xử lý (%s) giữ pending', async (status) => {
    respond(signResponse('querydr', { vnp_TransactionStatus: status }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'pending' });
  });

  it('querydr hoàn bị từ chối chuyển sang chờ người kiểm tra', async () => {
    respond(signResponse('querydr', { vnp_TransactionStatus: '09' }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'review' });
  });

  it('querydr trả thanh toán gốc thành công cho phép gửi lại cùng khoản hoàn', async () => {
    respond(signResponse('querydr', { vnp_TransactionType: '01', vnp_Amount: '25000000', vnp_TransactionNo: INPUT.transactionNo! }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry', canResubmit: true });
  });

  it('querydr trả thanh toán gốc sai số tiền không được coi là chưa hoàn', async () => {
    respond(signResponse('querydr', { vnp_TransactionType: '01', vnp_TransactionNo: INPUT.transactionNo! }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['01', '02', '04', '05', '06', '07', '09', 'unknown'])('querydr khoản trả gốc trạng thái %s không cho phép gửi lại', async (status) => {
    respond(signResponse('querydr', { vnp_TransactionType: '01', vnp_TransactionStatus: status, vnp_Amount: '25000000' }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'review' });
  });

  it.each(['', '00', '04', '99', 'unknown'])('querydr loại giao dịch không rõ %j không cho phép gửi lại', async (type) => {
    respond(signResponse('querydr', { vnp_TransactionType: type }));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'review' });
  });

  it('querydr thiếu loại giao dịch không cho phép gửi lại', async () => {
    const response = signResponse('querydr', { vnp_TransactionType: '' });
    delete response.vnp_TransactionType;
    respond(response);
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'review' });
  });

  it.each(['91', '99'])('querydr mã %s chữ ký sai không cho phép gửi lại', async (code) => {
    respond({ ...signResponse('querydr', { vnp_ResponseCode: code }), vnp_SecureHash: '0'.repeat(128) });
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['91', '99'])('querydr mã %s sai merchant hoặc giao dịch không cho phép gửi lại', async (code) => {
    const invalidIdentities: Record<string, string>[] = [{ vnp_TmnCode: 'ANOTHER' }, { vnp_TxnRef: 'ANOTHERPAY' }];
    for (const overrides of invalidIdentities) {
      respond(signResponse('querydr', { vnp_ResponseCode: code, ...overrides }));
      await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
    }
  });

  it('querydr khoản trả gốc chữ ký sai không cho phép gửi lại', async () => {
    respond({ ...signResponse('querydr', { vnp_TransactionType: '01', vnp_Amount: '25000000' }), vnp_SecureHash: '0'.repeat(128) });
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it.each(['refund', 'query'] as const)('%s hoàn thành lưu ngày GMT+7 và mã ngân hàng', async (method) => {
    respond(signResponse(method === 'refund' ? 'refund' : 'querydr', { vnp_BankCode: 'VCB', vnp_PayDate: '20260101000000' }));
    await expect(client[method](INPUT)).resolves.toEqual({ ...successfulOutcome, gatewayBankCode: 'VCB', gatewayRefundedAt: new Date('2025-12-31T17:00:00Z') });
  });

  it.each(['', '20260230000000', '20261110', 'unknown'])('ngày hoàn %j không hợp lệ được giữ null', async (payDate) => {
    for (const method of ['refund', 'query'] as const) {
      respond(signResponse(method === 'refund' ? 'refund' : 'querydr', { vnp_PayDate: payDate }));
      await expect(client[method](INPUT)).resolves.toEqual({ ...successfulOutcome, gatewayRefundedAt: null });
    }
  });

  it.each(['refund', 'query'] as const)('%s hoàn thành thiếu ngày và ngân hàng giữ metadata null', async (method) => {
    const response = signResponse(method === 'refund' ? 'refund' : 'querydr', { vnp_BankCode: '', vnp_PayDate: '' });
    delete response.vnp_BankCode;
    delete response.vnp_PayDate;
    respond(response);
    await expect(client[method](INPUT)).resolves.toEqual({ ...successfulOutcome, gatewayBankCode: null, gatewayRefundedAt: null });
  });

  it.each([
    ['mã merchant', { vnp_TmnCode: 'ANOTHER' }],
    ['mã giao dịch gốc', { vnp_TxnRef: 'ANOTHERPAY' }],
    ['số tiền hoàn', { vnp_Amount: '25000000' }],
    ['loại hoàn', { vnp_TransactionType: '02' }],
    ['mã giao dịch hoàn', { vnp_TransactionNo: '' }],
  ])('querydr thành công có %s không khớp trả retry', async (_label, overrides) => {
    respond(signResponse('querydr', overrides));
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
  });

  it('querydr kiểm checksum gồm cả promotion và phát hiện thay đổi sau khi ký', async () => {
    const response = signResponse('querydr', { vnp_PromotionCode: 'PROMO123', vnp_PromotionAmount: '100000' });
    respond(response);
    await expect(client.query(INPUT)).resolves.toEqual(successfulOutcome);

    respond({ ...response, vnp_PromotionAmount: '200000' });
    await expect(client.query(INPUT)).resolves.toEqual({ status: 'retry' });
  });
});
