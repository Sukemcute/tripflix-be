import { createHash, createHmac } from 'node:crypto';
import {
  buildVnpayMerchantRequestId, buildVnpayQueryRequest, buildVnpayRefundRequest,
  mapVnpayQueryResponse, mapVnpayRefundResponse, verifyVnpayMerchantResponse,
} from './vnpay-merchant-api.js';

const input = {
  tmnCode: 'TESTCODE', hashSecret: 'test-merchant-secret', txnRef: 'ORDER01', transactionNo: '123456',
  transactionDate: new Date('2026-11-09T17:00:01Z'), amount: 100000, paidAmount: 100000,
  requestId: 'Request01', now: new Date('2026-11-10T03:04:05Z'),
};
const sign = (text: string) => createHmac('sha512', input.hashSecret).update(text, 'utf8').digest('hex');
const refundResponse = {
  vnp_ResponseId: 'Response01', vnp_Command: 'refund', vnp_ResponseCode: '00', vnp_Message: 'Success',
  vnp_TmnCode: 'TESTCODE', vnp_TxnRef: 'ORDER01', vnp_Amount: '10000000', vnp_BankCode: 'NCB',
  vnp_PayDate: '20261110100405', vnp_TransactionNo: '987654', vnp_TransactionType: '02',
  vnp_TransactionStatus: '00', vnp_OrderInfo: 'Hoan tien don ORDER01',
};
const refundResponseSignData = 'Response01|refund|00|Success|TESTCODE|ORDER01|10000000|NCB|20261110100405|987654|02|00|Hoan tien don ORDER01';
const decimalCodes = Array.from({ length: 100 }, (_, code) => String(code).padStart(2, '0'));
const refundCodeOutcomes: Readonly<Record<string, string>> = { '00': 'succeeded', '02': 'retry', '03': 'retry', '94': 'pending', '97': 'retry', '99': 'retry' };
const queryCodeOutcomes: Readonly<Record<string, string>> = { '00': 'succeeded', '02': 'retry', '03': 'retry', '91': 'retry', '94': 'retry', '97': 'retry', '99': 'retry' };
const refundStatusOutcomes: Readonly<Record<string, string>> = { '00': 'succeeded', '05': 'pending', '06': 'pending' };

describe('vnpay-merchant-api', () => {
  it('ký hoàn toàn phần theo thứ tự Merchant API và ngày GMT+7', () => {
    const body = buildVnpayRefundRequest(input);
    expect(body).toEqual({
      vnp_RequestId: 'Request01', vnp_Version: '2.1.0', vnp_Command: 'refund', vnp_TmnCode: 'TESTCODE',
      vnp_TransactionType: '02', vnp_TxnRef: 'ORDER01', vnp_Amount: '10000000', vnp_TransactionNo: '123456',
      vnp_TransactionDate: '20261110000001', vnp_CreateBy: 'tripflix-system', vnp_CreateDate: '20261110100405',
      vnp_IpAddr: '127.0.0.1', vnp_OrderInfo: 'Hoan tien don ORDER01',
      vnp_SecureHash: sign('Request01|2.1.0|refund|TESTCODE|02|ORDER01|10000000|123456|20261110000001|tripflix-system|20261110100405|127.0.0.1|Hoan tien don ORDER01'),
    });
    expect(Object.values(body).every((value) => typeof value === 'string')).toBe(true);
  });

  it('ký hoàn một phần và giữ ô trống khi không có mã giao dịch VNPay', () => {
    const body = buildVnpayRefundRequest({ ...input, amount: 25000, transactionNo: null });
    expect(body.vnp_TransactionType).toBe('03');
    expect(body.vnp_TransactionNo).toBe('');
    expect(body.vnp_SecureHash).toBe(sign('Request01|2.1.0|refund|TESTCODE|03|ORDER01|2500000||20261110000001|tripflix-system|20261110100405|127.0.0.1|Hoan tien don ORDER01'));
  });

  it.each([
    { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: 100001 },
    { paidAmount: 0 }, { paidAmount: Number.NaN }, { amount: Number.POSITIVE_INFINITY },
    { amount: Number.MAX_SAFE_INTEGER, paidAmount: Number.MAX_SAFE_INTEGER },
  ])('từ chối số tiền hoàn không hợp lệ: %j', (invalidAmount) => {
    expect(() => buildVnpayRefundRequest({ ...input, ...invalidAmount })).toThrow(RangeError);
  });

  it('ký querydr không đưa mã giao dịch VNPay vào chuỗi ký', () => {
    const body = buildVnpayQueryRequest({ ...input, transactionNo: null });
    expect(body).toEqual({
      vnp_RequestId: 'Request01', vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: 'TESTCODE',
      vnp_TxnRef: 'ORDER01', vnp_TransactionNo: '', vnp_TransactionDate: '20261110000001',
      vnp_CreateDate: '20261110100405', vnp_IpAddr: '127.0.0.1', vnp_OrderInfo: 'Hoan tien don ORDER01',
      vnp_SecureHash: sign('Request01|2.1.0|querydr|TESTCODE|ORDER01|20261110000001|20261110100405|127.0.0.1|Hoan tien don ORDER01'),
    });
    expect(buildVnpayQueryRequest(input).vnp_SecureHash).toBe(body.vnp_SecureHash);
  });

  it('xác thực phản hồi hoàn bằng chữ ký độc lập và chấp nhận hex viết hoa', () => {
    const response = { ...refundResponse, vnp_SecureHash: sign(refundResponseSignData) };
    expect(verifyVnpayMerchantResponse(response, 'refund', input.hashSecret)).toBe(true);
    expect(verifyVnpayMerchantResponse({ ...response, vnp_SecureHash: response.vnp_SecureHash.toUpperCase() }, 'refund', input.hashSecret)).toBe(true);
    expect(verifyVnpayMerchantResponse({ ...response, vnp_Amount: '20000000' }, 'refund', input.hashSecret)).toBe(false);
    expect(verifyVnpayMerchantResponse(response, 'querydr', input.hashSecret)).toBe(false);
    expect(verifyVnpayMerchantResponse(response, 'refund', 'another-secret')).toBe(false);
  });

  it.each(['', 'a', 'g'.repeat(128), 'a'.repeat(127), 'a'.repeat(129)])('từ chối chữ ký thiếu hoặc sai định dạng: %s', (hash) => {
    expect(verifyVnpayMerchantResponse({ ...refundResponse, vnp_SecureHash: hash }, 'refund', input.hashSecret)).toBe(false);
  });

  it('từ chối phản hồi không có chữ ký', () => {
    expect(verifyVnpayMerchantResponse(refundResponse, 'refund', input.hashSecret)).toBe(false);
  });

  it('xác thực querydr gồm các trường khuyến mại và phát hiện sửa chúng', () => {
    const response = {
      ...refundResponse, vnp_Command: 'querydr', vnp_PromotionCode: 'SALE', vnp_PromotionAmount: '5000',
      vnp_SecureHash: sign('Response01|querydr|00|Success|TESTCODE|ORDER01|10000000|NCB|20261110100405|987654|02|00|Hoan tien don ORDER01|SALE|5000'),
    };
    expect(verifyVnpayMerchantResponse(response, 'querydr', input.hashSecret)).toBe(true);
    expect(verifyVnpayMerchantResponse({ ...response, vnp_PromotionAmount: '6000' }, 'querydr', input.hashSecret)).toBe(false);
    const noPromotion = {
      ...refundResponse, vnp_Command: 'querydr',
      vnp_SecureHash: sign('Response01|querydr|00|Success|TESTCODE|ORDER01|10000000|NCB|20261110100405|987654|02|00|Hoan tien don ORDER01||'),
    };
    expect(verifyVnpayMerchantResponse(noPromotion, 'querydr', input.hashSecret)).toBe(true);
  });

  it.each(decimalCodes)('ánh xạ mã phản hồi refund %s vào đúng một nhóm', (code) => {
    expect(mapVnpayRefundResponse({ ...refundResponse, vnp_ResponseCode: code })).toBe(refundCodeOutcomes[code] ?? 'review');
  });

  it.each(decimalCodes)('refund đã nhận yêu cầu dùng trạng thái tiền %s để quyết định', (status) => {
    expect(mapVnpayRefundResponse({ ...refundResponse, vnp_TransactionStatus: status })).toBe(refundStatusOutcomes[status] ?? 'review');
  });

  it.each(decimalCodes)('ánh xạ mã phản hồi querydr %s vào đúng một nhóm', (code) => {
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_ResponseCode: code })).toBe(queryCodeOutcomes[code] ?? 'review');
  });

  it.each(decimalCodes)('querydr giao dịch hoàn toàn phần dùng trạng thái %s', (status) => {
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_TransactionType: '02', vnp_TransactionStatus: status })).toBe(refundStatusOutcomes[status] ?? 'review');
  });

  it.each(decimalCodes)('querydr giao dịch hoàn một phần dùng trạng thái %s', (status) => {
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_TransactionType: '03', vnp_TransactionStatus: status })).toBe(refundStatusOutcomes[status] ?? 'review');
  });

  it.each(decimalCodes)('querydr khoản trả gốc trạng thái %s không được coi là hoàn thành công', (status) => {
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_TransactionType: '01', vnp_TransactionStatus: status })).toBe(status === '00' ? 'retry' : 'review');
  });

  it.each(['', '0', '100', '00 ', ' 00', 'unknown'])('mã phản hồi không rõ %j luôn cần người kiểm tra', (code) => {
    expect(mapVnpayRefundResponse({ ...refundResponse, vnp_ResponseCode: code })).toBe('review');
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_ResponseCode: code })).toBe('review');
  });

  it.each(['', '0', '100', '00 ', ' 00', 'unknown'])('trạng thái không rõ %j luôn cần người kiểm tra', (status) => {
    expect(mapVnpayRefundResponse({ ...refundResponse, vnp_TransactionStatus: status })).toBe('review');
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_TransactionStatus: status })).toBe('review');
  });

  it.each(['', '00', '04', '99', '1', 'unknown'])('querydr loại giao dịch không rõ %j luôn cần người kiểm tra', (type) => {
    expect(mapVnpayQueryResponse({ ...refundResponse, vnp_TransactionType: type })).toBe('review');
  });

  it('thiếu mã phản hồi hoặc trạng thái không được coi là thành công', () => {
    for (const field of ['vnp_ResponseCode', 'vnp_TransactionStatus'] as const) {
      const response: Record<string, string> = { ...refundResponse };
      delete response[field];
      expect(mapVnpayRefundResponse(response)).toBe('review');
      expect(mapVnpayQueryResponse(response)).toBe('review');
    }
    const response: Record<string, string> = { ...refundResponse };
    delete response.vnp_TransactionType;
    expect(mapVnpayQueryResponse(response)).toBe('review');
  });

  it('mã yêu cầu ổn định trong ngày Việt Nam và phân biệt lệnh, ngày, khóa hoàn', () => {
    const beforeMidnight = new Date('2026-11-09T16:59:59Z');
    const midnight = new Date('2026-11-09T17:00:00Z');
    const endOfDay = new Date('2026-11-10T16:59:59Z');
    const requestId = buildVnpayMerchantRequestId('refund-with-dashes', 'refund', midnight);
    expect(requestId).toMatch(/^[a-z0-9]{32}$/);
    expect(requestId).toBe(createHash('sha256').update('refund-with-dashes|refund|20261110', 'utf8').digest('hex').slice(0, 32));
    expect(buildVnpayMerchantRequestId('refund-with-dashes', 'refund', endOfDay)).toBe(requestId);
    expect(buildVnpayMerchantRequestId('refund-with-dashes', 'refund', beforeMidnight)).not.toBe(requestId);
    expect(buildVnpayMerchantRequestId('refund-with-dashes', 'querydr', midnight)).not.toBe(requestId);
    expect(buildVnpayMerchantRequestId('another-refund', 'refund', midnight)).not.toBe(requestId);
  });
});
