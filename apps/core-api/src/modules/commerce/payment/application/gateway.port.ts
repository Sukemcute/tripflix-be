/** Kết quả một lần trừ tiền ở cổng. */
export interface ChargeResult {
  status: 'succeeded' | 'requires_action' | 'failed';
  ref?: string;
  last4?: string;
  code?: string;
  message?: string;
  gatewayBankCode?: string | null;
  gatewayPaidAt?: Date | null;
}

/**
 * Cổng thanh toán, hệ thống ngoài: không nằm chung transaction với commerce, nên không gọi trong @Transactional.
 * Có hai bản: MockGateway (test, demo không cần mạng) và VnpayGateway (sandbox VNPay). Đổi bằng biến môi trường.
 */
export interface PaymentGateway {
  readonly name: string;
  /** Cùng gatewayKey thì trả lại đúng kết quả cũ, không trừ lần hai. */
  charge(input: { amount: number; token: string; gatewayKey: string }): Promise<ChargeResult>;
  confirm3ds(ref: string, otp: string): Promise<ChargeResult>;
  /** Đối soát: khoản trừ với khoá này thực sự ra sao ở cổng. */
  lookup(gatewayKey: string): Promise<ChargeResult | { status: 'not_found' }>;
  /** Chốt "khoản này không được trừ nữa", kể cả lệnh đang trên đường tới cổng; trả trạng thái cuối cùng. */
  voidCharge(gatewayKey: string): Promise<ChargeResult>;
  refund(input: { ref: string; amount: number; gatewayKey: string }): Promise<{ ref: string }>;
}

export const PAYMENT_GATEWAY = Symbol('COMMERCE_PAYMENT_GATEWAY');
