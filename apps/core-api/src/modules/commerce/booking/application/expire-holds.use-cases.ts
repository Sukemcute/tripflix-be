import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { VNPAY_GATEWAY, VNPAY_PAYMENT_WINDOW_MINUTES } from '../../payment/domain/vnpay-signature.js';
import { isHoldExpired } from '../domain/order-rules.js';
import { CheckoutUseCases } from './checkout.use-cases.js';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock, type OrderStore, type PaymentRecord } from './ports.js';

const EXPIRE_BATCH = 500;
/** Một lượt chạy làm tối đa chừng này rồi nhường lượt sau (job chạy mỗi phút), để không chồng lên lượt kế. */
const EXPIRE_RUN_BUDGET_MS = 45_000;

/** Mã ghi vào khoản trừ khi bỏ ngang được; null là chưa rõ kết quả (thẻ đang chờ cổng, trang VNPay còn hạn), không được đụng. */
function findAbandonCode(payment: PaymentRecord, redirectStartedBefore: Date): string | null {
  if (payment.status === 'requires_action') return '3ds_expired';
  if (payment.status === 'initiated' && payment.gateway === VNPAY_GATEWAY && payment.createdAt.getTime() <= redirectStartedBefore.getTime()) return 'vnpay_expired';
  return null;
}

/**
 * Nhả chỗ của đơn quá hạn giữ. Mỗi đơn một transaction để một đơn lỗi không kéo cả lô.
 * Khoá bằng SKIP LOCKED, không bao giờ chờ: applyResult khoá khoản trừ rồi mới khoá đơn, còn ở đây khoá đơn trước,
 * nên nếu chờ thì deadlock. Đơn đang bị bản khác hoặc TX2 giữ thì bỏ qua, lần chạy sau xét lại.
 */
@Injectable()
export class ExpireHoldsUseCases {
  private readonly logger = new Logger('CommerceExpireHolds');

  constructor(
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(COMMERCE_CLOCK) private readonly now: Clock,
    @Inject(CheckoutUseCases) private readonly checkout: CheckoutUseCases,
  ) {}

  async expireHolds(): Promise<{ expired: number; skipped: number; errors: number }> {
    const out = { expired: 0, skipped: 0, errors: 0 };
    const now = this.now();
    const redirectStartedBefore = new Date(now.getTime() - VNPAY_PAYMENT_WINDOW_MINUTES * 60_000);
    const startedAt = Date.now();
    // K1: lặp tới khi hết đơn quá hạn thay vì 500 đơn mỗi phút (đo 13/11: 1.200 giỏ mất 3 phút, job chỉ làm 14 giây).
    // Dừng khi lô không đầy, khi cả lô không nhả được đơn nào (đơn đang bị khoá, lượt sau xét lại) hoặc hết thời gian.
    for (;;) {
      const orderIds = await this.orders.findExpiredHoldIds({ now, redirectGateway: VNPAY_GATEWAY, redirectStartedBefore, limit: EXPIRE_BATCH });
      let expiredInBatch = 0;
      for (const orderId of orderIds) {
        try {
          if (await this.expireOrder(orderId, now, redirectStartedBefore)) expiredInBatch++;
          else out.skipped++;
        } catch (error) {
          out.errors++;
          this.logger.error({ err: error, orderId }, 'Nhả chỗ lỗi, lần chạy sau thử lại');
        }
      }
      out.expired += expiredInBatch;
      if (orderIds.length < EXPIRE_BATCH || expiredInBatch === 0 || Date.now() - startedAt > EXPIRE_RUN_BUDGET_MS) return out;
    }
  }

  /** Danh sách đọc không khoá nên xét lại mọi điều kiện sau khi khoá. */
  @Transactional('commerce')
  private async expireOrder(orderId: string, now: Date, redirectStartedBefore: Date): Promise<boolean> {
    const order = await this.orders.lockOrderSkipLocked(orderId);
    if (!order || !isHoldExpired(order.holdExpiresAt, now)) return false;
    if (order.status === 'paying') {
      const live = (await this.orders.findPaymentsOfOrder(orderId)).find((p) => p.status === 'initiated' || p.status === 'requires_action');
      const payment = live && (await this.orders.lockPaymentSkipLocked(live.id));
      const code = payment && findAbandonCode(payment, redirectStartedBefore);
      if (!code) return false;
      await this.orders.updatePayment(live.id, { status: 'failed', failureCode: code });
    } else if (order.status !== 'pending') {
      return false;
    }
    await this.checkout.releaseOrder(orderId, 'expired', 'Hết thời gian giữ chỗ');
    return true;
  }
}
