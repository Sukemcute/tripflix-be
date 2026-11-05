import { randomBytes } from 'node:crypto';
import type { Db } from '@tripflix/db';
import { eq } from 'drizzle-orm';
import { mockGatewayOps } from '../../db/schema/index.js';
import type { ChargeResult, PaymentGateway } from '../application/gateway.port.js';

/** Thẻ test, giống quy ước của Stripe. Chỉ các số này được chấp nhận. */
export const TEST_CARDS = [
  { number: '4242424242424242', label: 'Visa', outcome: 'succeeded' },
  { number: '5555555555554444', label: 'Mastercard', outcome: 'succeeded' },
  { number: '4000002500003155', label: 'Visa 3D Secure (OTP 123456)', outcome: 'requires_action' },
  { number: '4000000000000002', label: 'Visa bị từ chối', outcome: 'card_declined' },
  { number: '4000000000009995', label: 'Visa không đủ tiền', outcome: 'insufficient_funds' },
  { number: '4000000000000069', label: 'Visa hết hạn', outcome: 'expired_card' },
] as const;

const TEST_OTP = '123456';
const TOKEN_TTL_MS = 15 * 60_000;
const newRef = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;

/**
 * Cổng thanh toán giả lập, đóng vai hệ thống bên ngoài: có sổ riêng (mock_gateway_ops), không tham gia transaction của
 * commerce. Token thẻ cũng nằm trong sổ, nên tạo token ở bản core-api này rồi trả tiền ở bản khác vẫn chạy.
 * Không lưu số thẻ đầy đủ: chỉ kết quả của thẻ test và 4 số cuối.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock';

  constructor(private readonly db: Db) {}

  /** Đóng vai Stripe.js / form thẻ của cổng: đổi số thẻ lấy token, API đặt chỗ chỉ thấy token. */
  async createToken(cardNumber: string): Promise<{ paymentToken: string; last4: string; isTestCard: boolean }> {
    const number = cardNumber.replace(/\D/g, '');
    const card = TEST_CARDS.find((c) => c.number === number);
    const token = newRef('tok');
    await this.db.insert(mockGatewayOps).values({ gatewayKey: token, op: 'token', ref: token, status: card?.outcome ?? 'card_declined', last4: number.slice(-4) });
    return { paymentToken: token, last4: number.slice(-4), isTestCard: Boolean(card) };
  }

  async charge({ amount, token, gatewayKey }: { amount: number; token: string; gatewayKey: string }): Promise<ChargeResult> {
    // Cùng khoá thì trả lại đúng kết quả cũ, không trừ lần hai.
    const previous = await this.lookup(gatewayKey);
    if (previous.status !== 'not_found') return previous;
    const [tokenRow] = await this.db.select().from(mockGatewayOps).where(eq(mockGatewayOps.gatewayKey, token)).limit(1);
    const isExpired = !tokenRow || tokenRow.op !== 'token' || Date.now() - tokenRow.createdAt.getTime() > TOKEN_TTL_MS;
    const outcome = isExpired ? 'invalid_token' : tokenRow.status;
    const status = outcome === 'succeeded' || outcome === 'requires_action' ? outcome : 'failed';
    await this.db
      .insert(mockGatewayOps)
      .values({ gatewayKey, op: 'charge', ref: newRef(status === 'failed' ? 'mock_fail' : 'mock_pi'), amount, status, code: status === 'failed' ? outcome : null, last4: tokenRow?.last4 ?? null })
      .onConflictDoNothing();
    return (await this.lookup(gatewayKey)) as ChargeResult;
  }

  async confirm3ds(ref: string, otp: string): Promise<ChargeResult> {
    const [op] = await this.db.select().from(mockGatewayOps).where(eq(mockGatewayOps.ref, ref)).limit(1);
    if (!op || op.status !== 'requires_action') return { status: 'failed', code: '3ds_invalid' };
    const status = otp === TEST_OTP ? 'succeeded' : 'failed';
    await this.db.update(mockGatewayOps).set({ status, code: status === 'failed' ? '3ds_failed' : null }).where(eq(mockGatewayOps.ref, ref));
    return { status, ref, last4: op.last4 ?? undefined, code: status === 'failed' ? '3ds_failed' : undefined, message: status === 'failed' ? 'Mã OTP không đúng.' : undefined };
  }

  async lookup(gatewayKey: string): Promise<ChargeResult | { status: 'not_found' }> {
    const [op] = await this.db.select().from(mockGatewayOps).where(eq(mockGatewayOps.gatewayKey, gatewayKey)).limit(1);
    if (!op || op.op === 'token') return { status: 'not_found' };
    return { status: op.status as ChargeResult['status'], ref: op.ref, last4: op.last4 ?? undefined, code: op.code ?? undefined };
  }

  async voidCharge(gatewayKey: string): Promise<ChargeResult> {
    await this.db.insert(mockGatewayOps).values({ gatewayKey, op: 'charge', ref: newRef('mock_void'), status: 'failed', code: 'voided' }).onConflictDoNothing();
    return (await this.lookup(gatewayKey)) as ChargeResult;
  }

  async refund({ ref, amount, gatewayKey }: { ref: string; amount: number; gatewayKey: string }): Promise<{ ref: string }> {
    await this.db.insert(mockGatewayOps).values({ gatewayKey, op: 'refund', ref: `re_${ref}`, amount, status: 'refunded' }).onConflictDoNothing();
    const [op] = await this.db.select().from(mockGatewayOps).where(eq(mockGatewayOps.gatewayKey, gatewayKey)).limit(1);
    return { ref: op!.ref };
  }
}
