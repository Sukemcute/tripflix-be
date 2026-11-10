import { VNPAY_GATEWAY } from '../../payment/domain/vnpay-signature.js';
import type { OrderStatus } from './order-rules.js';

export type RefundSummaryStatus = 'refunded' | 'processing' | 'needs_review';

interface RefundState {
  status: 'initiated' | 'succeeded';
  needsReview: boolean;
}

interface RefundDetails extends RefundState {
  amount: number;
  gateway: string;
  gatewayBankCode?: string | null;
  gatewayRefundedAt?: Date | null;
  updatedAt?: Date | null;
}

export interface RefundSummary {
  amount: number;
  feeAmount: number;
  status: RefundSummaryStatus;
  method: 'vnpay' | 'card';
  bankCode: string | null;
  refundedAt: string | null;
}

export function getRefundStatus(refunds: readonly RefundState[]): RefundSummaryStatus {
  if (refunds.some((refund) => refund.needsReview)) return 'needs_review';
  return refunds.length > 0 && refunds.every((refund) => refund.status === 'succeeded') ? 'refunded' : 'processing';
}

function getRefundedAt(refund: RefundDetails): Date | null {
  // updated_at được chốt khi hoàn thành công; khoản đang xử lý chưa có ngày hoàn.
  return refund.gatewayRefundedAt ?? (refund.status === 'succeeded' ? refund.updatedAt ?? null : null);
}

export function summarizeRefunds(order: { status: OrderStatus; total: number; paidAt: Date | null }, refunds: readonly RefundDetails[]): RefundSummary | null {
  if (refunds.length === 0) return null;
  const amount = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const latestRefund = refunds.reduce((latest, refund) =>
    (getRefundedAt(refund)?.getTime() ?? -Infinity) > (getRefundedAt(latest)?.getTime() ?? -Infinity) ? refund : latest,
  );
  return {
    amount,
    feeAmount: order.status === 'cancelled' && order.paidAt != null ? Math.max(0, order.total - amount) : 0,
    status: getRefundStatus(refunds),
    method: latestRefund.gateway === VNPAY_GATEWAY ? 'vnpay' : 'card',
    bankCode: latestRefund.gatewayBankCode ?? null,
    refundedAt: getRefundedAt(latestRefund)?.toISOString() ?? null,
  };
}
