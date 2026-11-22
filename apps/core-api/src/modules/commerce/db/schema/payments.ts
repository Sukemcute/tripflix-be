import { createIdempotencyKeysTable } from '@tripflix/idempotency';
import { createOutboxTable } from '@tripflix/outbox';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { commerceSchema } from './commerce-schema.js';
import { orders } from './orders.js';

/**
 * Khoản trừ tiền. initiated: đã ghi ý định, kết quả ở cổng chưa rõ (job đối soát hỏi lại nếu kẹt);
 * requires_action: cổng đòi 3D Secure. gateway_key là khoá idempotency gửi sang cổng: cùng khoá thì cổng không trừ lần hai.
 */
export const payments = commerceSchema.table(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    userId: uuid('user_id').notNull(),
    gatewayKey: text('gateway_key').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('initiated'),
    gateway: text('gateway').notNull(),
    gatewayRef: text('gateway_ref'),
    gatewayBankCode: text('gateway_bank_code'),
    gatewayPaidAt: timestamp('gateway_paid_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    cardLast4: text('card_last4'),
    challengeId: text('challenge_id'),
    checkAttempts: integer('check_attempts').notNull().default(0),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_payments_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    check('ck_payments_status', sql`${t.status} in ('initiated', 'requires_action', 'succeeded', 'failed')`),
    check('ck_payments_amount', sql`${t.amount} > 0`),
    uniqueIndex('uq_payments_gateway_key').on(t.gatewayKey),
    // Chốt ở database: một đơn tối đa một khoản trừ đang chạy hoặc đã thành công, dù code sai hay khoá khác nhau.
    uniqueIndex('uq_payments_one_live_per_order').on(t.orderId).where(sql`${t.status} in ('initiated', 'requires_action', 'succeeded')`),
    index('idx_payments_due').on(t.nextCheckAt).where(sql`${t.status} = 'initiated' and not ${t.needsReview}`),
  ],
);

/** Khoản hoàn tiền. Khoá cố định theo lý do (vd comp:<orderId>) nên chạy lại không hoàn hai lần. */
export const refunds = commerceSchema.table(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    gatewayKey: text('gateway_key').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('initiated'),
    gatewayRef: text('gateway_ref'),
    gatewayBankCode: text('gateway_bank_code'),
    gatewayRefundedAt: timestamp('gateway_refunded_at', { withTimezone: true }),
    checkAttempts: integer('check_attempts').notNull().default(0),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_refunds_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    foreignKey({ name: 'fk_refunds_payment_id', columns: [t.paymentId], foreignColumns: [payments.id] }),
    check('ck_refunds_status', sql`${t.status} in ('initiated', 'succeeded')`),
    check('ck_refunds_amount', sql`${t.amount} > 0`),
    uniqueIndex('uq_refunds_gateway_key').on(t.gatewayKey),
  ],
);

/**
 * Sổ của cổng thanh toán giả lập (đóng vai hệ thống bên ngoài, như sổ của Stripe/VNPay): sống qua khởi động lại
 * để job đối soát hỏi lại được. Chỉ MockGateway đọc / ghi bảng này; nghiệp vụ commerce không đọc.
 */
export const mockGatewayOps = commerceSchema.table('mock_gateway_ops', {
  gatewayKey: text('gateway_key').primaryKey(),
  op: text('op').notNull(),
  ref: text('ref').notNull(),
  amount: bigint('amount', { mode: 'number' }),
  status: text('status').notNull(),
  code: text('code'),
  last4: text('last4'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Outbox của commerce (libs/outbox): ghi cùng transaction với thay đổi, relay gửi sang stream:core.commerce. */
export const commerceOutboxEvents = createOutboxTable(commerceSchema);

/** Kết quả lệnh ghi theo Idempotency-Key (libs/idempotency). */
export const commerceIdempotencyKeys = createIdempotencyKeysTable(commerceSchema);

export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
