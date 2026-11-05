import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ORDER_STORE, type OrderStore, type PaymentRecord } from '../../booking/application/ports.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { VNPAY_GATEWAY, VNPAY_PAYMENT_WINDOW_MINUTES, buildSignedUrl, buildVnpayTxnRef, formatVnpayDate, isValidSignature, isVnpaySuccess } from '../domain/vnpay-signature.js';
import { PaymentUseCases } from './payment.use-cases.js';

export const VNPAY_CONFIG = Symbol('COMMERCE_VNPAY_CONFIG');

/** Cấu hình merchant VNPay lấy từ biến môi trường; null khi chưa cấu hình (endpoint VNPay trả 404). */
export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  paymentUrl: string;
  returnUrl: string;
}

const hmacSha512 = (secret: string, data: string) => createHmac('sha512', secret).update(Buffer.from(data, 'utf8')).digest('hex');

/** Còn phải ghi callback này không: khoản chưa có kết quả, hoặc tiền về muộn cho khoản đã failed (phải hoàn). */
const shouldApplyCallback = (payment: PaymentRecord, params: Record<string, string>) => payment.status === 'initiated' || (payment.status === 'failed' && isVnpaySuccess(params));

/** Phản hồi IPN theo đúng quy ước của VNPay. */
export interface VnpayIpnResponse {
  RspCode: '00' | '01' | '02' | '04' | '97' | '99';
  Message: string;
}

/**
 * Thanh toán qua VNPay (sandbox): khác cổng giả lập ở chỗ kết quả không về ngay. Luồng: TX1 giống thẻ (đơn sang paying,
 * khoản trừ initiated) → trả URL đã ký để chuyển khách sang VNPay → VNPay gọi IPN (server với server) và chuyển trình duyệt
 * về Return URL → kiểm chữ ký, số tiền, rồi ghi kết quả bằng đúng TX2 của luồng thẻ (gọi nhiều lần vẫn an toàn).
 */
@Injectable()
export class VnpayUseCases {
  constructor(
    @Inject(VNPAY_CONFIG) private readonly config: VnpayConfig | null,
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(PaymentUseCases) private readonly payment: PaymentUseCases,
  ) {}

  async startPayment(userId: string, orderId: string, input: { expectedTotal: number; acceptedPolicyVersion: string; clientIp: string; bankCode?: string }): Promise<{ paymentUrl: string; expiresAt: string }> {
    const config = this.requireConfig();
    const method = { gatewayName: VNPAY_GATEWAY, buildKey: buildVnpayTxnRef };
    let prepared = await this.payment.prepareCharge(userId, orderId, input, method);
    // Lần trả VNPay trước chưa có kết quả (khách đóng trang, đổi cách trả): coi là bỏ ngang để trả lại được.
    // Nếu sau đó VNPay vẫn báo lần cũ thành công, TX2 tạo khoản hoàn riêng cho lần đó và chuyển người xử lý.
    if (prepared.kind === 'replay' && prepared.payment.gateway === VNPAY_GATEWAY && prepared.payment.status === 'initiated') {
      await this.payment.applyResult(prepared.payment.gatewayKey, { status: 'failed', code: 'vnpay_abandoned' });
      prepared = await this.payment.prepareCharge(userId, orderId, input, method);
    }
    if (prepared.kind === 'price_changed') {
      throw new CommerceError('conflict', 'Giá đã thay đổi, vui lòng xác nhận giá mới.', 'expectedTotal', { reason: 'PRICE_CHANGED', oldTotal: prepared.oldTotal, newTotal: prepared.newTotal });
    }
    if (prepared.kind === 'replay') throw new CommerceError('conflict', 'Đơn này đang có một lần thanh toán chưa xong.');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VNPAY_PAYMENT_WINDOW_MINUTES * 60_000);
    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      // VNPay tính theo đơn vị nhỏ nhất: nhân 100.
      vnp_Amount: String(prepared.amount * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: prepared.gatewayKey,
      vnp_OrderInfo: `Thanh toan don ${orderId}`,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: config.returnUrl,
      vnp_IpAddr: input.clientIp,
      vnp_CreateDate: formatVnpayDate(now),
      vnp_ExpireDate: formatVnpayDate(expiresAt),
      ...(input.bankCode && { vnp_BankCode: input.bankCode }),
    };
    return { paymentUrl: buildSignedUrl(config.paymentUrl, params, config.hashSecret, hmacSha512), expiresAt: expiresAt.toISOString() };
  }

  /** IPN: VNPay gọi thẳng server (không có token người dùng). Kiểm chữ ký, khoản trừ, số tiền rồi mới ghi kết quả. */
  async handleIpn(params: Record<string, string>): Promise<VnpayIpnResponse> {
    const config = this.config;
    if (!config || !isValidSignature(params, config.hashSecret, hmacSha512)) return { RspCode: '97', Message: 'Invalid signature' };
    const payment = (await this.orders.findPaymentsByKey(params.vnp_TxnRef ?? ''))[0];
    if (!payment || payment.gateway !== VNPAY_GATEWAY) return { RspCode: '01', Message: 'Order not found' };
    if (Number(params.vnp_Amount) !== payment.amount * 100) return { RspCode: '04', Message: 'Invalid amount' };
    if (!shouldApplyCallback(payment, params)) return { RspCode: '02', Message: 'Order already confirmed' };
    await this.applyCallback(params);
    return { RspCode: '00', Message: 'Confirm Success' };
  }

  /** Return URL: trình duyệt quay về sau khi trả. Kiểm chữ ký và ghi kết quả như IPN (an toàn khi IPN đã ghi trước). */
  async handleReturn(params: Record<string, string>): Promise<{ orderId: string | null; isValidSignature: boolean; isSuccess: boolean }> {
    const config = this.requireConfig();
    if (!isValidSignature(params, config.hashSecret, hmacSha512)) return { orderId: null, isValidSignature: false, isSuccess: false };
    const payment = (await this.orders.findPaymentsByKey(params.vnp_TxnRef ?? ''))[0];
    if (!payment || payment.gateway !== VNPAY_GATEWAY || Number(params.vnp_Amount) !== payment.amount * 100) return { orderId: null, isValidSignature: true, isSuccess: false };
    if (shouldApplyCallback(payment, params)) await this.applyCallback(params);
    // VNPay báo thành công chưa đủ: tiền về muộn thì đang chờ hoàn, trang kết quả không được báo đặt thành công.
    const settled = (await this.orders.findPaymentsByKey(payment.gatewayKey))[0]!;
    const order = await this.orders.findOrder(payment.orderId);
    return { orderId: payment.orderId, isValidSignature: true, isSuccess: isVnpaySuccess(params) && settled.status === 'succeeded' && order?.status === 'paid' };
  }

  private async applyCallback(params: Record<string, string>) {
    const isSuccess = isVnpaySuccess(params);
    const applied = await this.payment.applyResult(params.vnp_TxnRef!, {
      status: isSuccess ? 'succeeded' : 'failed',
      ref: params.vnp_TransactionNo,
      code: isSuccess ? undefined : `vnpay_${params.vnp_ResponseCode}`,
      last4: params.vnp_CardType,
    });
    if (applied.kind === 'compensated') await this.payment.processRefunds((await this.orders.findPaymentsByKey(params.vnp_TxnRef!))[0]!.orderId);
  }

  private requireConfig(): VnpayConfig {
    if (!this.config) throw new CommerceError('not_found', 'Chưa cấu hình VNPay.');
    return this.config;
  }
}
