export interface RefundInput {
  txnRef: string;
  transactionNo: string | null;
  transactionDate: Date;
  amount: number;
  paidAmount: number;
  requestId: string;
}

export type RefundOutcome = { status: 'succeeded'; ref: string; gatewayBankCode?: string | null; gatewayRefundedAt?: Date | null } | { status: 'pending' | 'review' } | { status: 'retry'; canResubmit?: boolean };
export type RefundQueryOutcome = RefundOutcome;

export interface RefundClient {
  refund(input: RefundInput): Promise<RefundOutcome>;
  query(input: RefundInput): Promise<RefundQueryOutcome>;
}

export type RefundGateways = ReadonlyMap<string, RefundClient>;
export const REFUND_GATEWAYS = Symbol('COMMERCE_REFUND_GATEWAYS');
// Giữ dấu đã nhận qua lần khởi động lại; mã giao dịch thật được ghi khi hoàn thành.
export const ACCEPTED_REFUND_REF = 'vnpay:accepted';
export const SUBMITTED_REFUND_REF = 'vnpay:submitted';
