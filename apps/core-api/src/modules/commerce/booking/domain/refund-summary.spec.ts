import { describe, expect, it } from 'vitest';
import { getRefundStatus, summarizeRefunds } from './refund-summary.js';

type RefundInput = Parameters<typeof summarizeRefunds>[1][number];
type OrderInput = Parameters<typeof summarizeRefunds>[0];

const PAID_AT = new Date('2026-11-10T03:00:00Z');
const EARLIER = new Date('2026-11-10T04:00:00Z');
const LATER = new Date('2026-11-10T05:00:00Z');
const order = (overrides: Partial<OrderInput> = {}): OrderInput => ({ status: 'cancelled', total: 1_000_000, paidAt: PAID_AT, ...overrides });
const refund = (overrides: Partial<RefundInput> = {}): RefundInput => ({ amount: 400_000, status: 'succeeded', needsReview: false, gateway: 'mock', ...overrides });

describe('getRefundStatus', () => {
  it('chưa có khoản hoàn thì vẫn đang xử lý', () => {
    expect(getRefundStatus([])).toBe('processing');
  });

  it('mọi khoản hoàn thành công thì đã hoàn', () => {
    expect(getRefundStatus([refund()])).toBe('refunded');
    expect(getRefundStatus([refund(), refund()])).toBe('refunded');
  });

  it('còn khoản chưa xong thì đang xử lý', () => {
    expect(getRefundStatus([refund({ status: 'initiated' })])).toBe('processing');
    expect(getRefundStatus([refund(), refund({ status: 'initiated' })])).toBe('processing');
  });

  it.each(['initiated', 'succeeded'] as const)('cần kiểm tra được ưu tiên khi khoản hoàn là %s', (status) => {
    expect(getRefundStatus([refund(), refund({ status, needsReview: true })])).toBe('needs_review');
  });
});

describe('summarizeRefunds', () => {
  it('không có khoản hoàn thì trả null', () => {
    expect(summarizeRefunds(order(), [])).toBeNull();
  });

  it('cộng mọi khoản hoàn và tính phí từ số tiền đã trả', () => {
    expect(summarizeRefunds(order(), [refund(), refund({ amount: 250_000 })])).toEqual({
      amount: 650_000, feeAmount: 350_000, status: 'refunded', method: 'card', bankCode: null, refundedAt: null,
    });
  });

  it('tổng hoàn vượt tiền đã trả thì phí bằng không', () => {
    expect(summarizeRefunds(order(), [refund({ amount: 1_100_000 })])?.feeAmount).toBe(0);
  });

  it.each([
    { status: 'cancelled', paidAt: null },
    { status: 'expired', paidAt: PAID_AT },
    { status: 'paid', paidAt: PAID_AT },
  ] satisfies Partial<OrderInput>[])('không suy ra phí cho đơn $status, paidAt=$paidAt', (overrides) => {
    expect(summarizeRefunds(order(overrides), [refund()])?.feeAmount).toBe(0);
  });

  it('còn khoản xử lý thì tổng trạng thái chưa hoàn xong', () => {
    expect(summarizeRefunds(order(), [refund(), refund({ status: 'initiated' })])?.status).toBe('processing');
    expect(summarizeRefunds(order(), [refund({ needsReview: true })])?.status).toBe('needs_review');
  });

  it.each(['vnpay', 'mock', 'other-gateway'])('đổi cổng %s thành phương thức hiển thị', (gateway) => {
    expect(summarizeRefunds(order(), [refund({ gateway })])?.method).toBe(gateway === 'vnpay' ? 'vnpay' : 'card');
  });

  it('giữ mã ngân hàng, thiếu mã thì trả null', () => {
    expect(summarizeRefunds(order(), [refund({ gatewayBankCode: 'NCB' })])?.bankCode).toBe('NCB');
    expect(summarizeRefunds(order(), [refund({ gatewayBankCode: null })])?.bankCode).toBeNull();
    expect(summarizeRefunds(order(), [refund()])?.bankCode).toBeNull();
  });

  it('ưu tiên ngày cổng hơn ngày cập nhật của cùng khoản hoàn', () => {
    expect(summarizeRefunds(order(), [refund({ gatewayRefundedAt: EARLIER, updatedAt: LATER })])?.refundedAt).toBe(EARLIER.toISOString());
  });

  it('chọn ngày hoàn mới nhất cùng ngân hàng và phương thức tương ứng', () => {
    const earlier = refund({ gateway: 'mock', gatewayBankCode: 'OLD', gatewayRefundedAt: EARLIER });
    const later = refund({ gateway: 'vnpay', gatewayBankCode: 'NCB', gatewayRefundedAt: LATER });
    expect(summarizeRefunds(order(), [later, earlier])).toMatchObject({ method: 'vnpay', bankCode: 'NCB', refundedAt: LATER.toISOString() });
    expect(summarizeRefunds(order(), [earlier, later])).toMatchObject({ method: 'vnpay', bankCode: 'NCB', refundedAt: LATER.toISOString() });
  });

  it('thiếu ngày cổng thì dùng ngày hoàn thành công', () => {
    expect(summarizeRefunds(order(), [refund({ updatedAt: LATER })])?.refundedAt).toBe(LATER.toISOString());
    expect(summarizeRefunds(order(), [refund({ gatewayRefundedAt: null, updatedAt: LATER })])?.refundedAt).toBe(LATER.toISOString());
    expect(summarizeRefunds(order(), [refund({ gatewayRefundedAt: EARLIER }), refund({ updatedAt: LATER })])?.refundedAt).toBe(LATER.toISOString());
  });

  it('chưa thành công thì không dùng ngày cập nhật làm ngày hoàn', () => {
    expect(summarizeRefunds(order(), [refund({ status: 'initiated', updatedAt: LATER })])?.refundedAt).toBeNull();
    expect(summarizeRefunds(order(), [refund({ status: 'initiated', updatedAt: LATER }), refund({ gatewayRefundedAt: EARLIER })])?.refundedAt).toBe(EARLIER.toISOString());
  });

  it('không có ngày hoàn thì trả null và giữ metadata của khoản đầu', () => {
    expect(summarizeRefunds(order(), [refund({ gateway: 'vnpay', gatewayBankCode: 'NCB' }), refund({ gateway: 'mock' })])).toMatchObject({ method: 'vnpay', bankCode: 'NCB', refundedAt: null });
  });

  it('trùng ngày hoàn thì giữ metadata của khoản đầu', () => {
    expect(summarizeRefunds(order(), [refund({ gateway: 'vnpay', gatewayBankCode: 'NCB', gatewayRefundedAt: LATER }), refund({ gateway: 'mock', gatewayRefundedAt: LATER })])).toMatchObject({ method: 'vnpay', bankCode: 'NCB', refundedAt: LATER.toISOString() });
  });
});
