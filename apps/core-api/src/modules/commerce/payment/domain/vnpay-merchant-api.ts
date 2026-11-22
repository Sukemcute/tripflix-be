import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { formatVnpayDate } from './vnpay-signature.js';

export type VnpayRefundOutcome = 'succeeded' | 'pending' | 'retry' | 'review';

export type VnpayMerchantRequestInput = {
  tmnCode: string;
  hashSecret: string;
  txnRef: string;
  transactionNo: string | null;
  transactionDate: Date;
  amount: number;
  paidAmount: number;
  requestId: string;
  now: Date;
};

const REFUND_REQUEST_FIELDS = [
  'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TransactionType',
  'vnp_TxnRef', 'vnp_Amount', 'vnp_TransactionNo', 'vnp_TransactionDate', 'vnp_CreateBy',
  'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
];
const QUERY_REQUEST_FIELDS = [
  'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef',
  'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
];
const RESPONSE_FIELDS = [
  'vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode',
  'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo',
  'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo',
];

function signMerchantFields(body: Record<string, string>, fields: string[], hashSecret: string): string {
  // Merchant API giữ cả ô trống và thứ tự trường, khác chữ ký URL thanh toán.
  const signData = fields.map((field) => body[field] ?? '').join('|');
  return createHmac('sha512', hashSecret).update(signData, 'utf8').digest('hex');
}

function buildMerchantBody(input: VnpayMerchantRequestInput, command: 'refund' | 'querydr'): Record<string, string> {
  return {
    vnp_RequestId: input.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: command,
    vnp_TmnCode: input.tmnCode,
    vnp_TxnRef: input.txnRef,
    vnp_TransactionNo: input.transactionNo ?? '',
    vnp_TransactionDate: formatVnpayDate(input.transactionDate),
    vnp_CreateDate: formatVnpayDate(input.now),
    vnp_IpAddr: '127.0.0.1',
    vnp_OrderInfo: `Hoan tien don ${input.txnRef}`,
  };
}

export function buildVnpayRefundRequest(input: VnpayMerchantRequestInput): Record<string, string> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 ||
      !Number.isSafeInteger(input.paidAmount) || input.paidAmount <= 0 ||
      input.amount > input.paidAmount || !Number.isSafeInteger(input.amount * 100)) {
    throw new RangeError('Số tiền hoàn phải là số nguyên dương và không vượt quá số tiền đã thanh toán.');
  }
  const body = {
    ...buildMerchantBody(input, 'refund'),
    vnp_TransactionType: input.amount === input.paidAmount ? '02' : '03',
    vnp_Amount: String(input.amount * 100),
    vnp_CreateBy: 'tripflix-system',
  };
  return { ...body, vnp_SecureHash: signMerchantFields(body, REFUND_REQUEST_FIELDS, input.hashSecret) };
}

export function buildVnpayQueryRequest(input: VnpayMerchantRequestInput): Record<string, string> {
  const body = buildMerchantBody(input, 'querydr');
  return { ...body, vnp_SecureHash: signMerchantFields(body, QUERY_REQUEST_FIELDS, input.hashSecret) };
}

export function verifyVnpayMerchantResponse(
  response: Record<string, string>, command: 'refund' | 'querydr', hashSecret: string,
): boolean {
  const receivedHash = response.vnp_SecureHash;
  if (response.vnp_Command !== command || typeof receivedHash !== 'string' || !/^[a-f\d]{128}$/i.test(receivedHash)) return false;
  const fields = command === 'querydr' ? [...RESPONSE_FIELDS, 'vnp_PromotionCode', 'vnp_PromotionAmount'] : RESPONSE_FIELDS;
  const expectedHash = signMerchantFields(response, fields, hashSecret);
  return timingSafeEqual(Buffer.from(receivedHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function mapVnpayRefundResponse(response: Record<string, string>): VnpayRefundOutcome {
  switch (response.vnp_ResponseCode) {
    case '00': return mapVnpayRefundStatus(response.vnp_TransactionStatus);
    case '94': return 'pending';
    case '02':
    case '03':
    case '97':
    case '99': return 'retry';
    case '91':
    case '95':
    default: return 'review';
  }
}

function mapVnpayRefundStatus(status: string | undefined): VnpayRefundOutcome {
  // API nhận yêu cầu chưa có nghĩa là ngân hàng đã trả tiền cho khách.
  switch (status) {
    case '00': return 'succeeded';
    case '05':
    case '06': return 'pending';
    default: return 'review';
  }
}

export function mapVnpayQueryResponse(response: Record<string, string>): VnpayRefundOutcome {
  if (response.vnp_ResponseCode !== '00') {
    switch (response.vnp_ResponseCode) {
      case '02':
      case '03':
      case '91':
      case '94':
      case '97':
      case '99': return 'retry';
      default: return 'review';
    }
  }
  const transactionType = response.vnp_TransactionType;
  const transactionStatus = response.vnp_TransactionStatus;
  if (transactionType === '01' && transactionStatus === '00') return 'retry';
  if (transactionType !== '02' && transactionType !== '03') return 'review';
  return mapVnpayRefundStatus(transactionStatus);
}

export function buildVnpayMerchantRequestId(gatewayKey: string, command: 'refund' | 'querydr', date: Date): string {
  // Giữ cùng mã trong ngày để thử lại sau timeout không sinh yêu cầu hoàn mới.
  const requestKey = `${gatewayKey}|${command}|${formatVnpayDate(date).slice(0, 8)}`;
  return createHash('sha256').update(requestKey, 'utf8').digest('hex').slice(0, 32);
}
