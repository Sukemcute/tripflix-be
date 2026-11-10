import type { RefundClient, RefundInput, RefundOutcome, RefundQueryOutcome } from '../application/refund-gateways.port.js';
import type { VnpayConfig } from '../application/vnpay.use-cases.js';
import { buildVnpayMerchantRequestId, buildVnpayQueryRequest, buildVnpayRefundRequest, mapVnpayQueryResponse, mapVnpayRefundResponse, verifyVnpayMerchantResponse } from '../domain/vnpay-merchant-api.js';
import { parseVnpayDate } from '../domain/vnpay-date.js';

export const VNPAY_DEFAULT_API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
const VNPAY_TIMEOUT_MS = 15_000;

/** Merchant API dùng JSON và chuỗi ký riêng, khác URL chuyển khách sang trang trả tiền. */
export class VnpayRefundClient implements RefundClient {
  constructor(private readonly config: VnpayConfig) {}

  async refund(input: RefundInput): Promise<RefundOutcome> {
    try {
      const now = new Date();
      const request = buildVnpayRefundRequest({ ...input, ...this.config, now, requestId: buildVnpayMerchantRequestId(input.requestId, 'refund', input.transactionDate) });
      const response = await this.post(request);
      if (!response || !this.isValidResponse(response, 'refund', input)) return { status: 'retry' };
      const status = mapVnpayRefundResponse(response);
      if (status === 'retry' && ['02', '03', '97'].includes(response.vnp_ResponseCode!)) return { status, canResubmit: true };
      if (status !== 'succeeded') return { status };
      if (!this.isMatchingRefund(response, input)) return { status: 'retry' };
      return this.describeSuccess(response);
    } catch {
      // Kết quả có thể đã được VNPay nhận; chỉ đối soát, không coi là hoàn thất bại.
      return { status: 'retry' };
    }
  }

  async query(input: RefundInput): Promise<RefundQueryOutcome> {
    try {
      const now = new Date();
      const request = buildVnpayQueryRequest({ ...input, ...this.config, now, requestId: buildVnpayMerchantRequestId(input.requestId, 'querydr', now) });
      const response = await this.post(request);
      if (!response || !this.isValidResponse(response, 'querydr', input)) return { status: 'retry' };
      const status = mapVnpayQueryResponse(response);
      if (status === 'succeeded') return this.isMatchingRefund(response, input) ? this.describeSuccess(response) : { status: 'retry' };
      if (status === 'retry') {
        // Querydr có thể chỉ thấy khoản trả gốc; gửi lại cùng khoản hoàn sẽ được VNPay chặn bằng mã 94.
        const isOriginalPayment = response.vnp_ResponseCode === '00' && response.vnp_TransactionType === '01' && response.vnp_TransactionStatus === '00';
        if (isOriginalPayment && response.vnp_Amount !== String(input.paidAmount * 100)) return { status: 'retry' };
        if (isOriginalPayment || ['91', '99'].includes(response.vnp_ResponseCode!)) return { status: 'retry', canResubmit: true };
      }
      return { status };
    } catch {
      return { status: 'retry' };
    }
  }

  private describeSuccess(response: Record<string, string>): RefundOutcome {
    return { status: 'succeeded', ref: response.vnp_TransactionNo!, gatewayBankCode: response.vnp_BankCode || null, gatewayRefundedAt: parseVnpayDate(response.vnp_PayDate) };
  }

  private isValidResponse(response: Record<string, string>, command: 'refund' | 'querydr', input: RefundInput): boolean {
    return verifyVnpayMerchantResponse(response, command, this.config.hashSecret)
      && response.vnp_Command === command && response.vnp_TmnCode === this.config.tmnCode && response.vnp_TxnRef === input.txnRef;
  }

  private isMatchingRefund(response: Record<string, string>, input: RefundInput): boolean {
    return response.vnp_Amount === String(input.amount * 100)
      && response.vnp_TransactionType === (input.amount === input.paidAmount ? '02' : '03') && Boolean(response.vnp_TransactionNo);
  }

  private async post(request: Record<string, string>): Promise<Record<string, string> | null> {
    const response = await fetch(this.config.apiUrl ?? VNPAY_DEFAULT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(VNPAY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    // Phản hồi bên ngoài phải được kiểm kiểu trước khi đưa vào bộ kiểm chữ ký.
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.values(body).every((value) => typeof value === 'string')) return null;
    return body as Record<string, string>;
  }
}
