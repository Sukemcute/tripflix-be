import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { commerceSchema } from './commerce-schema.js';

/**
 * Đơn đặt chỗ. pending: đang giữ chỗ chờ trả (hết hạn sau 30 phút); paying: đã gửi lệnh trừ tiền, chờ kết quả cổng;
 * paid: đã trả, chỗ đã bán. user_id trỏ sang access.users nhưng không đặt khoá ngoại vì khác schema.
 */
export const orders = commerceSchema.table(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull().default('pending'),
    total: bigint('total', { mode: 'number' }).notNull(),
    adults: smallint('adults').notNull(),
    sourcePostId: text('source_post_id'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    policyVersion: text('policy_version'),
    policyAcceptedAt: timestamp('policy_accepted_at', { withTimezone: true }),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    confirmationCode: text('confirmation_code'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_orders_status', sql`${t.status} in ('pending', 'paying', 'paid', 'cancelled', 'expired')`),
    check('ck_orders_total', sql`${t.total} > 0`),
    check('ck_orders_adults', sql`${t.adults} between 1 and 9`),
    index('idx_orders_user_id').on(t.userId, t.createdAt),
    index('idx_orders_hold').on(t.status, t.holdExpiresAt),
    // Mỗi tài khoản một giỏ đang giữ: chống một người giữ nhiều giỏ để giam chỗ.
    uniqueIndex('uq_orders_one_pending_per_user').on(t.userId).where(sql`${t.status} = 'pending'`),
  ],
);

/** Mỗi mục của đơn: một loại phòng (nhiều đêm) hoặc một hạng ghế (một ngày bay). Giá chốt lúc giữ chỗ / trả tiền. */
export const orderItems = commerceSchema.table(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    productType: text('product_type').notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    nights: smallint('nights').notNull(),
    qty: smallint('qty').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
    ratePlanCode: text('rate_plan_code').notNull(),
    ratePlanName: text('rate_plan_name').notNull(),
    isRefundable: boolean('is_refundable').notNull(),
    freeCancelUntil: date('free_cancel_until', { mode: 'string' }),
    confirmationCode: text('confirmation_code'),
  },
  (t) => [
    foreignKey({ name: 'fk_order_items_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    index('idx_order_items_order_id').on(t.orderId),
    check('ck_order_items_product_type', sql`${t.productType} in ('room', 'flight')`),
    check('ck_order_items_qty', sql`${t.qty} between 1 and 9`),
    check('ck_order_items_nights', sql`${t.nights} between 1 and 14`),
  ],
);

/** Hành khách / khách lưu trú. Vé bay cần đủ từng người, họ tên theo giấy tờ và ngày sinh. */
export const orderGuests = commerceSchema.table(
  'order_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    fullName: text('full_name').notNull(),
    birthdate: date('birthdate', { mode: 'string' }),
  },
  (t) => [
    foreignKey({ name: 'fk_order_guests_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    index('idx_order_guests_order_id').on(t.orderId),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
