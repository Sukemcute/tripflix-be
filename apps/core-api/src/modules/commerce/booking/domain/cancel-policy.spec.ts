import { describe, expect, it } from 'vitest';
import { quoteCancellation, type CancelPolicyItem } from './cancel-policy.js';

const TODAY = '2026-12-01';
const room = (overrides: Partial<CancelPolicyItem> = {}): CancelPolicyItem => ({
  id: 'room',
  productType: 'room',
  date: '2026-12-20',
  qty: 2,
  unitPrice: 500_000,
  lineTotal: 3_000_000,
  isRefundable: true,
  freeCancelUntil: '2026-12-17',
  ...overrides,
});
const flight = (overrides: Partial<CancelPolicyItem> = {}): CancelPolicyItem =>
  room({ id: 'flight', productType: 'flight', qty: 1, unitPrice: 2_000_000, lineTotal: 2_000_000, ...overrides });

describe('quoteCancellation', () => {
  it('còn hạn huỷ miễn phí thì hoàn 100%, kể cả đúng ngày cuối', () => {
    expect(quoteCancellation([room({ freeCancelUntil: TODAY })], TODAY)).toMatchObject({ refundAmount: 3_000_000, feeAmount: 0 });
    expect(quoteCancellation([flight()], TODAY)).toMatchObject({ refundAmount: 2_000_000, feeAmount: 0 });
  });

  it('phòng quá hạn: mất đêm đầu của mọi phòng, hoàn phần còn lại', () => {
    expect(quoteCancellation([room({ freeCancelUntil: '2026-11-30' })], TODAY)).toMatchObject({ refundAmount: 2_000_000, feeAmount: 1_000_000 });
  });

  it('phòng một đêm quá hạn thì không còn gì để hoàn', () => {
    const item = room({ qty: 1, unitPrice: 800_000, lineTotal: 800_000, freeCancelUntil: '2026-11-30' });
    expect(quoteCancellation([item], TODAY)).toMatchObject({ refundAmount: 0, feeAmount: 800_000 });
  });

  it('vé bay quá hạn và gói không hoàn huỷ thì không hoàn', () => {
    expect(quoteCancellation([flight({ freeCancelUntil: '2026-11-30' })], TODAY)).toMatchObject({ refundAmount: 0 });
    expect(quoteCancellation([room({ isRefundable: false, freeCancelUntil: null })], TODAY)).toMatchObject({ refundAmount: 0, feeAmount: 3_000_000 });
  });

  it('tính riêng từng mục rồi cộng lại', () => {
    const quote = quoteCancellation([room(), room({ id: 'late', freeCancelUntil: '2026-11-30' }), flight({ freeCancelUntil: '2026-11-30' })], TODAY);
    expect(quote).toMatchObject({ refundAmount: 5_000_000, feeAmount: 3_000_000 });
    expect(quote.lines.map((line) => line.rule)).toEqual(['free_cancel', 'first_night_fee', 'non_refundable']);
  });

  it('một mục đã tới ngày đi hoặc nhận phòng thì không huỷ được cả đơn', () => {
    expect(quoteCancellation([room(), flight({ date: TODAY })], TODAY)).toMatchObject({ isCancellable: false, reason: 'ALREADY_STARTED', refundAmount: 0 });
  });
});
