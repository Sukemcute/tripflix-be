import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { getRefundStatus, type RefundSummaryStatus } from '../../booking/domain/refund-summary.js';
import type { OutboxWriter } from '@tripflix/outbox';
import { CheckoutUseCases, listRequiredPassengers, listSortedCells, passengerMixOf, type CheckoutView } from '../../booking/application/checkout.use-cases.js';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock, type OrderStore, type PaymentRecord, type RefundRecord } from '../../booking/application/ports.js';
import {
  MAX_FAILED_PAYMENTS,
  buildCancelRefundKey,
  POLICY_VERSION,
  buildChargeKey,
  buildCompensationRefundKey,
  buildLateSuccessRefundKey,
  createConfirmationCode,
  hasCompleteGuests,
  isHoldExpired,
} from '../../booking/domain/order-rules.js';
import { quoteCancellation, type CancelQuote, type CancelPolicyItem } from '../../booking/domain/cancel-policy.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { addDays } from '../../inventory/domain/sales-rules.js';
import { PAYMENT_GATEWAY, type ChargeResult, type PaymentGateway } from './gateway.port.js';
import { ACCEPTED_REFUND_REF, REFUND_GATEWAYS, SUBMITTED_REFUND_REF, type RefundClient, type RefundGateways, type RefundInput, type RefundOutcome, type RefundQueryOutcome } from './refund-gateways.port.js';

export const COMMERCE_OUTBOX = Symbol('COMMERCE_OUTBOX');

const GATEWAY_TIMEOUT_MS = 15_000;
const RECONCILE_BATCH = 100;
const CHECK_BACKOFF_SECONDS = [60, 120, 300, 900, 3600];
// Khoảng một ngày hỏi lại; quá thì chờ người xử lý thay vì hỏi mãi.
const MAX_CHECKS = 30;
const BREAKER_THRESHOLD = 5;
const BREAKER_PAUSE_MS = 60_000;

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('gateway timeout')), ms).unref())]);

export interface PayInput {
  paymentToken: string;
  expectedTotal: number;
  acceptedPolicyVersion: string;
}

export type RefundStatus = 'none' | RefundSummaryStatus;

export interface CancelPaidResult {
  orderId: string;
  status: 'cancelled';
  refundAmount: number;
  feeAmount: number;
  refundStatus: RefundStatus;
  bankCode?: string;
  refundedAt?: string;
}

export type PayResult =
  | { outcome: 'paid'; orderId: string; confirmationCode: string | null; checkout: CheckoutView; bankCode?: string; paidAt?: string }
  | { outcome: 'requires_action'; orderId: string; challengeId: string }
  | { outcome: 'pending'; orderId: string; message: string };

export type Prepared =
  | { kind: 'replay'; payment: PaymentRecord }
  | { kind: 'price_changed'; oldTotal: number; newTotal: number }
  | { kind: 'charge'; gatewayKey: string; amount: number };

export type Applied = { kind: 'paid' } | { kind: 'compensated' } | { kind: 'requires_action'; challengeId: string } | { kind: 'failed'; code: string; message?: string };

/**
 * Trả tiền (TF29): TX1 ghi ý định trả, đơn sang paying → gọi cổng NGOÀI transaction → TX2 ghi kết quả, chốt đơn,
 * held → sold, outbox commerce.order.paid. Cổng là hệ thống ngoài nên không nằm chung transaction: server chết giữa hai
 * transaction thì khoản trừ nằm ở initiated, job đối soát hỏi lại cổng rồi chốt hoặc hoàn tiền.
 */
@Injectable()
export class PaymentUseCases {
  private readonly logger = new Logger('CommercePayment');
  private gatewayPausedUntil = 0;

  constructor(
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(COMMERCE_OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(COMMERCE_CLOCK) private readonly now: Clock,
    @Inject(CheckoutUseCases) private readonly checkout: CheckoutUseCases,
    @Inject(REFUND_GATEWAYS) private readonly refundGateways: RefundGateways = new Map(),
  ) {}

  async pay(userId: string, orderId: string, input: PayInput): Promise<PayResult> {
    const prepared = await this.prepareCharge(userId, orderId, input, { gatewayName: this.gateway.name, buildKey: buildChargeKey });
    if (prepared.kind === 'price_changed') {
      throw new CommerceError('conflict', 'Giá đã thay đổi, vui lòng xác nhận giá mới.', 'expectedTotal', { reason: 'PRICE_CHANGED', oldTotal: prepared.oldTotal, newTotal: prepared.newTotal });
    }
    if (prepared.kind === 'replay') return this.describe(userId, orderId, prepared.payment);

    let result: ChargeResult;
    try {
      result = await withTimeout(this.gateway.charge({ amount: prepared.amount, token: input.paymentToken, gatewayKey: prepared.gatewayKey }), GATEWAY_TIMEOUT_MS);
    } catch {
      // Không rõ kết quả (mất mạng, timeout) thì KHÔNG coi là thất bại: tiền có thể đã bị trừ. Job đối soát hỏi lại.
      return { outcome: 'pending', orderId, message: 'Chưa nhận được kết quả từ cổng thanh toán, đang kiểm tra lại. Bạn chưa cần trả lại.' };
    }
    return this.finish(userId, orderId, prepared.gatewayKey, result);
  }

  async confirm3ds(userId: string, orderId: string, input: { challengeId: string; otp: string }): Promise<PayResult> {
    const order = await this.checkout.ownOrder(userId, orderId);
    const payment = await this.orders.findPaymentByChallenge(orderId, input.challengeId);
    if (!payment || payment.status !== 'requires_action') throw new CommerceError('not_found', 'Phiên xác thực không tồn tại.');
    // Hết hạn giữ chỗ thì không cho xác nhận OTP: tránh chốt đơn mà chỗ đã có thể bị nhả.
    if (isHoldExpired(order.holdExpiresAt, this.now())) {
      await this.applyResult(payment.gatewayKey, { status: 'failed', code: '3ds_expired' });
      throw new CommerceError('gone', 'Hết thời gian giữ chỗ trước khi xác thực xong.');
    }
    const result = await withTimeout(this.gateway.confirm3ds(payment.gatewayRef!, input.otp), GATEWAY_TIMEOUT_MS);
    return this.finish(userId, orderId, payment.gatewayKey, { ...result, last4: result.last4 ?? payment.cardLast4 ?? undefined });
  }

  private async finish(userId: string, orderId: string, gatewayKey: string, result: ChargeResult): Promise<PayResult> {
    let applied: Applied;
    try {
      applied = await this.applyResult(gatewayKey, result);
    } catch (error) {
      if (error instanceof CommerceError) throw error;
      // Đã có kết quả từ cổng mà ghi database lỗi: khoản vẫn ở initiated, job đối soát làm lại.
      this.logger.error({ err: error, orderId }, 'Ghi kết quả thanh toán lỗi');
      return { outcome: 'pending', orderId, message: 'Đang xác nhận thanh toán. Bạn chưa cần trả lại.' };
    }
    if (applied.kind === 'requires_action') return { outcome: 'requires_action', orderId, challengeId: applied.challengeId };
    if (applied.kind === 'compensated') {
      await this.processRefunds(orderId);
      throw new CommerceError('gone', 'Đơn đã hết hạn giữ chỗ trước khi thanh toán xong. Tiền đã được hoàn lại.');
    }
    if (applied.kind === 'failed') {
      throw new CommerceError('payment_failed', applied.message ?? 'Thanh toán không thành công.', 'paymentToken', { declineCode: applied.code });
    }
    const checkout = await this.checkout.getCheckout(userId, orderId);
    const payment = (await this.orders.findPaymentsByKey(gatewayKey))[0];
    return { outcome: 'paid', orderId, confirmationCode: checkout.confirmationCode, checkout, ...this.describePaymentMetadata(payment) };
  }

  private async describe(userId: string, orderId: string, payment: PaymentRecord): Promise<PayResult> {
    if (payment.status === 'succeeded') {
      const checkout = await this.checkout.getCheckout(userId, orderId);
      return { outcome: 'paid', orderId, confirmationCode: checkout.confirmationCode, checkout, ...this.describePaymentMetadata(payment) };
    }
    if (payment.status === 'requires_action') return { outcome: 'requires_action', orderId, challengeId: payment.challengeId! };
    return { outcome: 'pending', orderId, message: 'Đang xử lý lần thanh toán này.' };
  }

  private describePaymentMetadata(payment: PaymentRecord | undefined): { bankCode?: string; paidAt?: string } {
    return { ...(payment?.gatewayBankCode && { bankCode: payment.gatewayBankCode }), ...(payment?.gatewayPaidAt && { paidAt: payment.gatewayPaidAt.toISOString() }) };
  }

  /** TX1: khoá đơn, kiểm điều kiện, tính lại giá từ lịch trống, ghi khoản trừ initiated, đơn sang paying. */
  @Transactional('commerce')
  async prepareCharge(
    userId: string,
    orderId: string,
    input: Omit<PayInput, 'paymentToken'>,
    method: { gatewayName: string; buildKey: (orderId: string, attempt: number) => string },
  ): Promise<Prepared> {
    const order = await this.checkout.ownOrder(userId, orderId, { lock: true });
    if (order.status === 'paid') {
      const paid = (await this.orders.findPaymentsOfOrder(orderId)).find((p) => p.status === 'succeeded');
      if (paid) return { kind: 'replay', payment: paid };
    }
    if (order.status === 'paying') {
      const live = (await this.orders.findPaymentsOfOrder(orderId)).find((p) => p.status === 'initiated' || p.status === 'requires_action');
      if (live) return { kind: 'replay', payment: live };
    }
    this.checkout.assertPending(order);
    const items = await this.orders.findItems(orderId);
    const passengersRequired = listRequiredPassengers(order, items).length;
    if (!hasCompleteGuests({ contactName: order.contactName, contactPhone: order.contactPhone, guestBirthdates: await this.orders.findGuestBirthdates(orderId), passengersRequired })) {
      throw new CommerceError('invalid_query', 'Chưa đủ thông tin khách.', 'guests');
    }
    if (input.acceptedPolicyVersion !== POLICY_VERSION) throw new CommerceError('invalid_query', 'Vui lòng đọc và đồng ý chính sách đặt chỗ, huỷ và hoàn tiền.', 'acceptedPolicyVersion', { policyVersion: POLICY_VERSION });
    const failed = await this.orders.countFailedCharges(orderId);
    if (failed >= MAX_FAILED_PAYMENTS) throw new CommerceError('rate_limited', 'Thử thẻ quá nhiều lần, đơn này bị khoá thanh toán.');

    // Tính lại giá từ lịch trống: giá có thể đổi trong lúc giữ chỗ (admin sửa lịch).
    const repriced = await this.checkout.priceItems(
      items.map((i) => ({ productId: i.productId, checkIn: i.date, checkOut: i.productType === 'room' ? addDays(i.date, i.nights) : undefined, qty: i.productType === 'room' ? i.qty : undefined, ratePlanCode: i.ratePlanCode })),
      passengerMixOf(order),
    ).catch((error: unknown) => {
      // Giữ chỗ rồi thì luật bán (CTA, ngừng bán) không chặn được nữa: chỉ lấy giá mới, chỗ đã có.
      if (error instanceof CommerceError && error.code === 'conflict') return null;
      throw error;
    });
    let total = order.total;
    if (repriced) {
      await this.orders.updateItemPrices(
        items.map((item, i) => {
          const { unitPrice, childUnitPrice, infantUnitPrice, lineTotal } = repriced[i]!;
          return { id: item.id, unitPrice, childUnitPrice, infantUnitPrice, lineTotal };
        }),
      );
      total = repriced.reduce((sum, p) => sum + p.lineTotal, 0);
      await this.orders.updateOrder(orderId, { total });
    }
    if (input.expectedTotal !== total) return { kind: 'price_changed', oldTotal: input.expectedTotal, newTotal: total };

    const gatewayKey = method.buildKey(orderId, failed + 1);
    await this.orders.updateOrder(orderId, { status: 'paying', policyVersion: POLICY_VERSION, policyAcceptedAt: this.now() });
    await this.orders.insertPayment({ orderId, userId, gatewayKey, amount: total, gateway: method.gatewayName });
    return { kind: 'charge', gatewayKey, amount: total };
  }

  /** TX2: ghi kết quả cổng trả về. Dùng chung cho luồng thường, 3DS và job đối soát; gọi lại nhiều lần vẫn an toàn. */
  @Transactional('commerce')
  async applyResult(gatewayKey: string, result: ChargeResult): Promise<Applied> {
    const payment = await this.orders.lockPaymentByKey(gatewayKey);
    if (!payment) throw new CommerceError('not_found', 'Không có khoản trừ này.');
    const order = (await this.orders.lockOrder(payment.orderId))!;

    if (result.status === 'requires_action') {
      if (payment.status === 'requires_action') return { kind: 'requires_action', challengeId: payment.challengeId! };
      const challengeId = randomUUID();
      await this.orders.updatePayment(payment.id, { status: 'requires_action', gatewayRef: result.ref ?? null, cardLast4: result.last4 ?? null, challengeId });
      return { kind: 'requires_action', challengeId };
    }

    if (result.status === 'succeeded') {
      const metadata = {
        ...(result.gatewayBankCode != null && { gatewayBankCode: result.gatewayBankCode }),
        ...(result.gatewayPaidAt != null && { gatewayPaidAt: result.gatewayPaidAt }),
      };
      if (payment.status === 'succeeded') return order.status === 'paid' ? { kind: 'paid' } : { kind: 'compensated' };
      // Cổng không hỗ trợ mới chuyển người xử lý; khoản tự động vẫn được job nhặt nếu server chết sau TX2.
      const needsReview = !this.hasRefundGateway(payment.gateway);
      if (payment.status === 'failed') {
        // Tiền về muộn cho lần đã bỏ ngang: giữ failed vì đơn có thể đang có khoản khác còn sống (uq_payments_one_live_per_order).
        // Không đụng đơn và chỗ; chỉ ghi mã giao dịch để hoàn đúng giao dịch đó.
        await this.orders.updatePayment(payment.id, { gatewayRef: result.ref ?? payment.gatewayRef, cardLast4: result.last4 ?? payment.cardLast4, ...metadata });
        await this.orders.insertRefund({ orderId: order.id, paymentId: payment.id, gatewayKey: buildLateSuccessRefundKey(payment.id), amount: payment.amount, reason: 'late_success', needsReview });
        return { kind: 'compensated' };
      }
      await this.orders.updatePayment(payment.id, { status: 'succeeded', gatewayRef: result.ref ?? null, cardLast4: result.last4 ?? null, failureCode: null, ...metadata });
      if (order.status !== 'paying') {
        // Tiền đã trừ mà đơn không còn chờ trả (hết hạn, đã huỷ): bù bằng hoàn tiền, không chốt đơn.
        await this.orders.insertRefund({ orderId: order.id, paymentId: payment.id, gatewayKey: buildCompensationRefundKey(order.id), amount: payment.amount, reason: 'compensation', needsReview });
        return { kind: 'compensated' };
      }
      const items = await this.orders.findItems(order.id);
      for (const cell of listSortedCells(items)) {
        if (!(await this.orders.sellCell(cell))) throw new Error(`Không chuyển được chỗ đã giữ sang đã bán: ${cell.productId} ${cell.date}`);
      }
      const codes = items.map((item) => ({ id: item.id, code: createConfirmationCode(randomBytes(6)) }));
      await this.orders.setItemConfirmationCodes(codes);
      await this.orders.updateOrder(order.id, { status: 'paid', confirmationCode: codes[0]!.code, paidAt: this.now() });
      const flightRoutes = await this.checkout.findFlightRoutes(items.filter((i) => i.productType === 'flight').map((i) => i.productId));
      const guests = await this.orders.findGuests(order.id);
      await this.outbox.add({
        type: 'commerce.order.paid',
        userId: order.userId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          total: payment.amount,
          sourcePostId: order.sourcePostId,
          items: items.map((i) => ({
            productType: i.productType,
            productId: i.productId,
            date: i.date,
            nights: i.nights,
            qty: i.qty,
            productName: i.productName,
            propertyName: i.propertyName ?? null,
            ratePlanName: i.ratePlanName,
            flight: flightRoutes.get(i.productId) ?? null,
          })),
          guests,
          confirmationCode: codes[0]!.code,
          contactName: order.contactName,
          contactEmail: order.contactEmail,
        },
      });
      return { kind: 'paid' };
    }

    // Thẻ bị từ chối: chỗ vẫn giữ để thử thẻ khác, lần sau dùng khoá mới.
    // Khoản đã có kết quả từ trước thì không đụng đơn: đơn có thể đang paying vì một lần trả mới còn sống.
    const wasLive = payment.status === 'initiated' || payment.status === 'requires_action';
    if (wasLive) {
      await this.orders.updatePayment(payment.id, { status: 'failed', failureCode: result.code ?? 'declined', cardLast4: result.last4 ?? payment.cardLast4 });
    }
    if (wasLive && order.status === 'paying') {
      const otherPending = (await this.orders.lockOrdersOfUser(order.userId, ['pending'])).length > 0;
      if (otherPending) await this.checkout.releaseOrder(order.id, 'cancelled', 'Đã giữ giỏ mới');
      else await this.orders.updateOrder(order.id, { status: 'pending' });
    }
    return { kind: 'failed', code: result.code ?? 'declined', message: result.message };
  }

  private todayInVietnam(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(this.now());
  }

  /** Báo phí huỷ và số tiền được hoàn trước khi khách xác nhận. */
  async getCancelQuote(userId: string, orderId: string): Promise<{ orderId: string; quote: CancelQuote | { isCancellable: false; reason: 'NOT_PAID'; refundAmount: 0; feeAmount: 0; lines: [] } }> {
    const order = await this.orders.findOrder(orderId);
    if (!order || order.userId !== userId) throw new CommerceError('not_found', 'Không tìm thấy đơn.');
    if (order.status !== 'paid') return { orderId, quote: { isCancellable: false, reason: 'NOT_PAID', refundAmount: 0, feeAmount: 0, lines: [] } };
    return { orderId, quote: quoteCancellation((await this.orders.findItems(orderId)) as CancelPolicyItem[], this.todayInVietnam()) };
  }

  /** Huỷ đơn đã trả: chốt trong transaction rồi mới gọi cổng để hoàn; cổng lỗi thì job đối soát thử lại. */
  async cancelPaid(userId: string, orderId: string): Promise<CancelPaidResult> {
    const applied = await this.applyCancelPaid(userId, orderId);
    if (applied.refundAmount > 0 && !applied.needsReview) await this.processRefunds(orderId);
    const cancelRefund = applied.refundAmount > 0 ? (await this.orders.findRefundsOfOrder(orderId)).find((refund) => refund.gatewayKey === buildCancelRefundKey(orderId)) : undefined;
    const isDone = cancelRefund?.status === 'succeeded';
    // Cổng có thể từ chối ngay trong lần thử đầu; trả đúng trạng thái vừa ghi để khách không chờ nhầm.
    const needsReview = applied.needsReview || cancelRefund?.needsReview === true;
    const refundStatus: RefundStatus = applied.refundAmount === 0 ? 'none' : getRefundStatus([{ status: cancelRefund?.status ?? 'initiated', needsReview }]);
    const refunded = isDone ? cancelRefund : undefined;
    return { orderId, status: 'cancelled', refundAmount: applied.refundAmount, feeAmount: applied.feeAmount, refundStatus,
      ...(refunded?.gatewayBankCode && { bankCode: refunded.gatewayBankCode }), ...(refunded?.gatewayRefundedAt && { refundedAt: refunded.gatewayRefundedAt.toISOString() }) };
  }

  @Transactional('commerce')
  private async applyCancelPaid(userId: string, orderId: string): Promise<{ refundAmount: number; feeAmount: number; needsReview: boolean }> {
    const order = await this.orders.lockOrder(orderId);
    if (!order || order.userId !== userId) throw new CommerceError('not_found', 'Không tìm thấy đơn.');
    if (order.status !== 'paid') throw new CommerceError('conflict', 'Chỉ huỷ được đơn đã thanh toán.', undefined, { reason: 'NOT_PAID' });
    const items = await this.orders.findItems(orderId);
    const quote = quoteCancellation(items as CancelPolicyItem[], this.todayInVietnam());
    if (!quote.isCancellable) throw new CommerceError('conflict', 'Đã tới ngày đi hoặc ngày nhận phòng, không huỷ được đơn.', undefined, { reason: quote.reason });
    const payment = (await this.orders.findPaymentsOfOrder(orderId)).find((p) => p.status === 'succeeded');
    if (!payment) throw new Error(`Đơn đã trả nhưng không có khoản thanh toán: ${orderId}`);
    for (const cell of listSortedCells(items)) await this.orders.unsellCell(cell);
    await this.orders.updateOrder(orderId, { status: 'cancelled', cancelReason: 'Khách huỷ đơn đã thanh toán', cancelledAt: this.now() });
    const refundAmount = Math.min(quote.refundAmount, payment.amount);
    const needsReview = refundAmount > 0 && !this.hasRefundGateway(payment.gateway);
    if (refundAmount > 0) {
      await this.orders.insertRefund({ orderId, paymentId: payment.id, gatewayKey: buildCancelRefundKey(orderId), amount: refundAmount, reason: 'customer_cancel', needsReview });
    }
    await this.outbox.add({
      type: 'commerce.order.cancelled',
      userId: order.userId,
      payload: {
        orderId,
        userId: order.userId,
        total: order.total,
        refundAmount,
        feeAmount: quote.feeAmount,
        confirmationCode: order.confirmationCode,
        contactName: order.contactName,
        contactEmail: order.contactEmail,
      },
    });
    return { refundAmount, feeAmount: quote.feeAmount, needsReview };
  }

  /** Thực hiện các khoản hoàn còn nợ của đơn; cổng lỗi thì để job đối soát thử lại (khoá cố định, không hoàn hai lần). */
  async processRefunds(orderId: string): Promise<number> {
    let done = 0;
    for (const refund of await this.claimOrderRefunds(orderId)) {
      try {
        if (await this.executeRefund(refund)) done++;
      } catch (error) {
        if (refund.checkAttempts >= MAX_CHECKS) await this.orders.markForReview('refund', refund.id);
        this.logger.warn({ err: error, refundId: refund.id }, 'Hoàn tiền lỗi, job đối soát sẽ thử lại');
      }
    }
    return done;
  }

  private hasRefundGateway(gateway: string): boolean {
    return gateway === this.gateway.name || this.refundGateways.has(gateway);
  }

  private async executeRefund(refund: RefundRecord): Promise<boolean> {
    if (refund.gateway === this.gateway.name) {
      const completed = await withTimeout(this.gateway.refund({ ref: refund.parentRef!, amount: refund.amount, gatewayKey: refund.gatewayKey }), GATEWAY_TIMEOUT_MS);
      await this.orders.markRefundSucceeded(refund.id, completed.ref);
      return true;
    }
    const client = this.refundGateways.get(refund.gateway);
    if (!client) {
      await this.orders.markForReview('refund', refund.id);
      return false;
    }
    const input: RefundInput = {
      txnRef: refund.parentGatewayKey,
      transactionNo: refund.parentRef,
      transactionDate: refund.parentCreatedAt,
      amount: refund.amount,
      paidAmount: refund.parentAmount,
      requestId: `${refund.gatewayKey}:${refund.checkAttempts}`,
    };
    // Sau lần gửi đầu, luôn hỏi lại trước: phản hồi thành công có thể đã mất trên đường về.
    const wasSubmitted = refund.gatewayRef === ACCEPTED_REFUND_REF || refund.gatewayRef?.startsWith(SUBMITTED_REFUND_REF) === true;
    const shouldQuery = refund.checkAttempts > 1 || wasSubmitted;
    let outcome: RefundQueryOutcome | null = shouldQuery
      ? await withTimeout(client.query(input), GATEWAY_TIMEOUT_MS)
      : await this.submitRefund(refund.id, client, input);
    if (!outcome) return false;
    if (shouldQuery && outcome.status === 'retry' && outcome.canResubmit) {
      // Khoá theo lượt đối soát để lease cũ không gửi lại đồng thời với lượt mới.
      outcome = await this.submitRefund(refund.id, client, input, { expectedRef: refund.gatewayRef, checkAttempts: refund.checkAttempts });
    }
    if (!outcome) return false;
    if (outcome.status === 'succeeded') {
      const metadata = { ...(outcome.gatewayBankCode != null && { gatewayBankCode: outcome.gatewayBankCode }), ...(outcome.gatewayRefundedAt != null && { gatewayRefundedAt: outcome.gatewayRefundedAt }) };
      await this.orders.markRefundSucceeded(refund.id, outcome.ref, ...(Object.keys(metadata).length ? [metadata] as const : []));
      return true;
    }
    if (outcome.status === 'pending') await this.orders.markRefundAccepted(refund.id, ACCEPTED_REFUND_REF);
    if (outcome.status === 'review' || (outcome.status === 'pending' && refund.checkAttempts >= MAX_CHECKS)) await this.orders.markForReview('refund', refund.id);
    if (outcome.status === 'retry') throw new Error('Chưa xác nhận được kết quả hoàn tiền từ cổng.');
    return false;
  }

  private async submitRefund(refundId: string, client: RefundClient, input: RefundInput, claim?: { expectedRef: string | null; checkAttempts: number }): Promise<RefundOutcome | null> {
    // Ghi trước khi gửi để đối soát biết yêu cầu có thể đã được VNPay nhận.
    const submittedRef = claim ? `${SUBMITTED_REFUND_REF}:${claim.checkAttempts}` : SUBMITTED_REFUND_REF;
    if (!(await this.orders.markRefundSubmitted(refundId, submittedRef, ...(claim ? [claim] as const : [])))) return null;
    // Refund giữ mã cố định; querydr vẫn có mã riêng từng lượt để không bị trùng truy vấn.
    const outcome = await withTimeout(client.refund({ ...input, requestId: input.requestId.replace(/:\d+$/, '') }), GATEWAY_TIMEOUT_MS);
    // Chỉ cho gửi lại khi phản hồi có chữ ký xác nhận yêu cầu đã bị từ chối trước khi xử lý.
    if (outcome.status === 'retry' && outcome.canResubmit) await this.orders.markRefundSubmitted(refundId, null, ...(claim ? [{ expectedRef: submittedRef, checkAttempts: claim.checkAttempts }] as const : []));
    return outcome;
  }

  @Transactional('commerce')
  private claimOrderRefunds(orderId: string): Promise<RefundRecord[]> {
    // Nhận lượt và đẩy lịch trước khi gọi mạng để request và job không cùng gửi khoản hoàn.
    return this.orders.claimDueRefunds({ orderId, olderThanSeconds: 0, limit: RECONCILE_BATCH, backoffSeconds: CHECK_BACKOFF_SECONDS });
  }

  @Transactional('commerce')
  private claimDueCharges(olderThanSeconds: number) {
    return this.orders.claimDueCharges({ gateway: this.gateway.name, olderThanSeconds, limit: RECONCILE_BATCH, backoffSeconds: CHECK_BACKOFF_SECONDS });
  }

  @Transactional('commerce')
  private claimDueRefunds(olderThanSeconds: number) {
    return this.orders.claimDueRefunds({ olderThanSeconds, limit: RECONCILE_BATCH, backoffSeconds: CHECK_BACKOFF_SECONDS });
  }

  /**
   * Job đối soát: khoản trừ kẹt ở initiated thì hỏi cổng rồi chốt; cổng chưa có thì huỷ trước rồi mới kết luận, để lệnh
   * đang trên đường không trừ được nữa. Hoàn tiền còn nợ thì làm nốt. Cổng lỗi liên tiếp thì tạm nghỉ (circuit breaker).
   */
  async reconcile(olderThanSeconds = 60): Promise<{ settled: number; refunds: number; errors: number; isPaused: boolean }> {
    const out = { settled: 0, refunds: 0, errors: 0, isPaused: false };
    if (Date.now() < this.gatewayPausedUntil) return { ...out, isPaused: true };
    let streak = 0;
    const onGatewayError = () => {
      out.errors++;
      if (++streak < BREAKER_THRESHOLD) return false;
      this.gatewayPausedUntil = Date.now() + BREAKER_PAUSE_MS;
      out.isPaused = true;
      return true;
    };
    for (const payment of await this.claimDueCharges(olderThanSeconds)) {
      try {
        const found = await withTimeout(this.gateway.lookup(payment.gatewayKey), GATEWAY_TIMEOUT_MS);
        const result = found.status === 'not_found' ? await withTimeout(this.gateway.voidCharge(payment.gatewayKey), GATEWAY_TIMEOUT_MS) : found;
        streak = 0;
        const applied = await this.applyResult(payment.gatewayKey, result);
        if (applied.kind === 'compensated') await this.processRefunds(payment.orderId);
        out.settled++;
      } catch (error) {
        if (payment.checkAttempts >= MAX_CHECKS) await this.orders.markForReview('charge', payment.id);
        this.logger.warn({ err: error, paymentId: payment.id }, 'Đối soát khoản trừ lỗi');
        if (onGatewayError()) return out;
      }
    }
    for (const refund of await this.claimDueRefunds(olderThanSeconds)) {
      try {
        const isDone = await this.executeRefund(refund);
        streak = 0;
        if (isDone) out.refunds++;
      } catch (error) {
        if (refund.checkAttempts >= MAX_CHECKS) await this.orders.markForReview('refund', refund.id);
        this.logger.warn({ err: error, refundId: refund.id }, 'Hoàn tiền lỗi');
        if (onGatewayError()) return out;
      }
    }
    return out;
  }
}
