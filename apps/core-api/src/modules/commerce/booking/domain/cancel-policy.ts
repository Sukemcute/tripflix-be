// Chính sách huỷ đơn đã thanh toán (TF70): tính tiền hoàn cho từng mục rồi cộng lại, huỷ cả đơn.

export interface CancelPolicyItem {
  id: string;
  productType: 'room' | 'flight';
  date: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  isRefundable: boolean;
  freeCancelUntil: string | null;
}

export type CancelRule = 'free_cancel' | 'first_night_fee' | 'non_refundable';

export interface CancelQuoteLine {
  itemId: string;
  rule: CancelRule;
  refundAmount: number;
  feeAmount: number;
}

export type CancelQuote =
  | { isCancellable: true; refundAmount: number; feeAmount: number; lines: CancelQuoteLine[] }
  | { isCancellable: false; reason: 'ALREADY_STARTED'; refundAmount: 0; feeAmount: 0; lines: [] };

function quoteLine(item: CancelPolicyItem, today: string): CancelQuoteLine {
  const noRefund = { itemId: item.id, rule: 'non_refundable' as const, refundAmount: 0, feeAmount: item.lineTotal };
  if (!item.isRefundable) return noRefund;
  if (item.freeCancelUntil && today <= item.freeCancelUntil) {
    return { itemId: item.id, rule: 'free_cancel', refundAmount: item.lineTotal, feeAmount: 0 };
  }
  if (item.productType === 'flight') return noRefund;
  // unitPrice đã trừ giảm giá trẻ em của phòng này, nên phí đêm đầu không vượt số khách đã trả.
  const feeAmount = Math.min(item.lineTotal, item.unitPrice * item.qty);
  return { itemId: item.id, rule: 'first_night_fee', refundAmount: item.lineTotal - feeAmount, feeAmount };
}

export function quoteCancellation(items: CancelPolicyItem[], today: string): CancelQuote {
  if (items.some((item) => today >= item.date)) {
    return { isCancellable: false, reason: 'ALREADY_STARTED', refundAmount: 0, feeAmount: 0, lines: [] };
  }
  const lines = items.map((item) => quoteLine(item, today));
  return {
    isCancellable: true,
    refundAmount: lines.reduce((sum, line) => sum + line.refundAmount, 0),
    feeAmount: lines.reduce((sum, line) => sum + line.feeAmount, 0),
    lines,
  };
}
