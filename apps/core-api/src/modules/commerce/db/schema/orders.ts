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
    // Vé bay: trẻ em 2–11 tuổi chiếm ghế, em bé dưới 2 tuổi ngồi lòng người lớn (TF29).
    children: smallint('children').notNull().default(0),
    infants: smallint('infants').notNull().default(0),
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
    /** Ai đổi trạng thái lần gần nhất (D1): "POST /api/v1/checkout", "job:expire-holds"... Trigger chép sang order_status_history. */
    statusSource: text('status_source'),
    /** x-request-id của request đổi trạng thái lần gần nhất; job thì là mã lượt chạy. */
    statusRequestId: text('status_request_id'),
    /** TF37: lúc đã nhắc khách 24h trước chuyến; đặt bằng UPDATE ... WHERE ... IS NULL nên mỗi đơn chỉ nhắc một lần. */
    departureRemindedAt: timestamp('departure_reminded_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_orders_status', sql`${t.status} in ('pending', 'paying', 'paid', 'cancelled', 'expired')`),
    check('ck_orders_total', sql`${t.total} > 0`),
    check('ck_orders_adults', sql`${t.adults} between 1 and 9`),
    check('ck_orders_children', sql`${t.children} >= 0 and ${t.adults} + ${t.children} <= 9`),
    check('ck_orders_infants', sql`${t.infants} between 0 and ${t.adults}`),
    index('idx_orders_user_id').on(t.userId, t.createdAt),
    // K3: mã xác nhận đọc cho khách nên không được trùng; trùng thì TX2 lỗi, job đối soát chạy lại với mã mới.
    uniqueIndex('uq_orders_confirmation_code').on(t.confirmationCode),
    index('idx_orders_hold').on(t.status, t.holdExpiresAt),
    // Mỗi tài khoản một giỏ đang giữ: chống một người giữ nhiều giỏ để giam chỗ.
    // Job nhắc chỉ quét đơn đã trả chưa nhắc: index nhỏ, đơn đã nhắc tự rơi khỏi index.
    index('idx_orders_departure_reminder').on(t.status).where(sql`${t.status} = 'paid' and ${t.departureRemindedAt} is null`),
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
    /** Phòng: một đêm một phòng. Vé bay: một vé người lớn. */
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    /** Vé bay: một vé trẻ em và em bé; phòng là null. lineTotal = người lớn + trẻ em + em bé theo nhóm khách của đơn. */
    childUnitPrice: bigint('child_unit_price', { mode: 'number' }),
    infantUnitPrice: bigint('infant_unit_price', { mode: 'number' }),
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
    /** Vé bay: adult, child, infant; khách lưu trú của đơn chỉ có phòng là null. */
    passengerType: text('passenger_type'),
  },
  (t) => [
    foreignKey({ name: 'fk_order_guests_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    index('idx_order_guests_order_id').on(t.orderId),
    check('ck_order_guests_passenger_type', sql`${t.passengerType} in ('adult', 'child', 'infant')`),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;

/**
 * Lịch sử trạng thái đơn (D1, rà soát 13/11): mỗi lần đổi trạng thái một dòng, do trigger trên orders ghi nên không đường
 * ghi nào bị sót. Trả lời được: đơn đổi lúc nào, từ đâu (khách, job, IPN), thuộc request nào để lần sang log và sự kiện.
 */
export const orderStatusHistory = commerceSchema.table(
  'order_status_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid('order_id').notNull(),
    /** null khi đơn vừa được tạo. */
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    source: text('source'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_order_status_history_order_id', columns: [t.orderId], foreignColumns: [orders.id] }),
    index('idx_order_status_history_order_id').on(t.orderId, t.createdAt),
  ],
);
