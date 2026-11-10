import { Injectable } from '@nestjs/common';
import { InjectTransactionHost, type Db } from '@tripflix/db';
import { and, asc, count, desc, eq, exists, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { flightInventory, orderGuests, orderItems, orders, payments, properties, refunds, roomInventory, roomTypes, type OrderItemRow, type OrderRow, type PaymentRow } from '../../db/schema/index.js';
import { SUBMITTED_REFUND_REF } from '../../payment/application/refund-gateways.port.js';
import type { OrderStatus, PassengerType } from '../domain/order-rules.js';
import type { InventoryCell, NewOrderItem, OrderItemRecord, OrderRecord, OrderStore, PaymentRecord, RefundRecord } from '../application/ports.js';

/** host.tx là transaction đang mở của commerce, hoặc kết nối thường; test truyền { tx: db }. */
export interface OrderDbHost {
  readonly tx: Db;
}

const mapOrder = (row: OrderRow): OrderRecord => ({
  id: row.id,
  userId: row.userId,
  status: row.status as OrderStatus,
  total: row.total,
  adults: row.adults,
  children: row.children,
  infants: row.infants,
  sourcePostId: row.sourcePostId,
  contactName: row.contactName,
  contactPhone: row.contactPhone,
  contactEmail: row.contactEmail,
  holdExpiresAt: row.holdExpiresAt,
  confirmationCode: row.confirmationCode,
  cancelReason: row.cancelReason,
  cancelledAt: row.cancelledAt,
  createdAt: row.createdAt,
  paidAt: row.paidAt,
});

const mapItem = (row: OrderItemRow): OrderItemRecord => ({ ...row, productType: row.productType as 'room' | 'flight' });

/** Mục phòng kèm tên khách sạn (vé bay là null); đọc lúc xem đơn nên không cần thêm cột. */
const mapItemWithProperty = (row: { item: OrderItemRow; propertyName: string | null }): OrderItemRecord => ({ ...mapItem(row.item), propertyName: row.propertyName });

const mapPayment = (row: PaymentRow): PaymentRecord => ({
  id: row.id,
  orderId: row.orderId,
  userId: row.userId,
  gatewayKey: row.gatewayKey,
  amount: row.amount,
  status: row.status as PaymentRecord['status'],
  gateway: row.gateway,
  gatewayRef: row.gatewayRef,
  gatewayBankCode: row.gatewayBankCode,
  gatewayPaidAt: row.gatewayPaidAt,
  failureCode: row.failureCode,
  cardLast4: row.cardLast4,
  challengeId: row.challengeId,
  checkAttempts: row.checkAttempts,
  createdAt: row.createdAt,
});

const POSTGRES_LOCK_NOT_AVAILABLE = '55P03';

@Injectable()
export class DrizzleOrderStore implements OrderStore {
  constructor(@InjectTransactionHost('commerce') private readonly host: OrderDbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

  async lockUser(userId: string) {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  }

  async limitLockWait(milliseconds: number) {
    await this.db.execute(sql`select set_config('lock_timeout', ${`${milliseconds}ms`}, true)`);
  }

  isLockWaitTimeout(error: unknown) {
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    return code === POSTGRES_LOCK_NOT_AVAILABLE || cause?.code === POSTGRES_LOCK_NOT_AVAILABLE;
  }

  async countOrdersCreatedSince(userId: string, since: Date) {
    const [row] = await this.db.select({ n: count() }).from(orders).where(and(eq(orders.userId, userId), gte(orders.createdAt, since)));
    return row?.n ?? 0;
  }

  async findOrder(orderId: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return row ? mapOrder(row) : null;
  }

  async lockOrder(orderId: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, orderId)).for('update');
    return row ? mapOrder(row) : null;
  }

  async lockOrdersOfUser(userId: string, statuses: OrderStatus[]) {
    const rows = await this.db.select().from(orders).where(and(eq(orders.userId, userId), inArray(orders.status, statuses))).for('update');
    return rows.map(mapOrder);
  }

  async findExpiredHoldIds(input: { now: Date; redirectGateway: string; redirectStartedBefore: Date; limit: number }) {
    // Lọc ngay trong câu truy vấn: đơn thẻ chờ đối soát có thể nằm rất lâu, không được chiếm chỗ trong lô.
    const abandonedCharges = this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orders.id),
          or(eq(payments.status, 'requires_action'), and(eq(payments.status, 'initiated'), eq(payments.gateway, input.redirectGateway), lte(payments.createdAt, input.redirectStartedBefore))),
        ),
      );
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(lte(orders.holdExpiresAt, input.now), or(eq(orders.status, 'pending'), and(eq(orders.status, 'paying'), exists(abandonedCharges)))))
      .orderBy(asc(orders.holdExpiresAt))
      .limit(input.limit);
    return rows.map((r) => r.id);
  }

  async lockOrderSkipLocked(orderId: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, orderId)).for('update', { skipLocked: true });
    return row ? mapOrder(row) : null;
  }

  async lockPaymentSkipLocked(paymentId: string) {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, paymentId)).for('update', { skipLocked: true });
    return row ? mapPayment(row) : null;
  }

  async listOrdersOfUser(input: { userId: string; statuses?: OrderStatus[]; after?: { createdAt: Date; id: string }; limit: number; hidesUnpaidClosed?: boolean }) {
    // Postgres giữ tới micro giây, Date của JS chỉ tới mili giây: so và sắp theo mili giây để con trỏ không bỏ sót đơn.
    const createdAtMs = sql`date_trunc('milliseconds', ${orders.createdAt})`;
    const rows = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, input.userId),
          input.statuses?.length ? inArray(orders.status, input.statuses) : undefined,
          // Giữ chỗ chưa trả mà đã hết giờ hoặc bị huỷ thì không còn ý nghĩa với khách; đơn đã trả rồi huỷ vẫn hiện để theo dõi hoàn tiền.
          input.hidesUnpaidClosed
            ? sql`not ((${orders.status} in ('expired', 'cancelled') and ${orders.paidAt} is null) or (${orders.status} = 'pending' and ${orders.holdExpiresAt} <= now()))`
            : undefined,
          input.after ? or(sql`${createdAtMs} < ${input.after.createdAt.toISOString()}::timestamptz`, and(sql`${createdAtMs} = ${input.after.createdAt.toISOString()}::timestamptz`, lt(orders.id, input.after.id))) : undefined,
        ),
      )
      .orderBy(desc(createdAtMs), desc(orders.id))
      .limit(input.limit);
    return rows.map(mapOrder);
  }

  async findItemsOfOrders(orderIds: string[]) {
    if (!orderIds.length) return [];
    return (await this.selectItemsWithProperty().where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.date), asc(orderItems.id))).map(mapItemWithProperty);
  }

  async insertOrder(order: { userId: string; total: number; adults: number; children: number; infants: number; sourcePostId: string | null; holdExpiresAt: Date }) {
    const [row] = await this.db.insert(orders).values(order).returning({ id: orders.id });
    return row!.id;
  }

  async insertItems(orderId: string, items: NewOrderItem[]) {
    if (items.length) await this.db.insert(orderItems).values(items.map((i) => ({ ...i, orderId })));
  }

  async findItems(orderId: string) {
    return (await this.selectItemsWithProperty().where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.date), asc(orderItems.id))).map(mapItemWithProperty);
  }

  private selectItemsWithProperty() {
    return this.db
      .select({ item: orderItems, propertyName: properties.name })
      .from(orderItems)
      .leftJoin(roomTypes, and(eq(orderItems.productType, 'room'), eq(roomTypes.id, orderItems.productId)))
      .leftJoin(properties, eq(properties.id, roomTypes.propertyId));
  }

  async updateItemPrices(prices: { id: string; unitPrice: number; childUnitPrice: number | null; infantUnitPrice: number | null; lineTotal: number }[]) {
    for (const { id, ...price } of prices) await this.db.update(orderItems).set(price).where(eq(orderItems.id, id));
  }

  async setItemConfirmationCodes(codes: { id: string; code: string }[]) {
    for (const c of codes) await this.db.update(orderItems).set({ confirmationCode: c.code }).where(eq(orderItems.id, c.id));
  }

  async updateOrder(orderId: string, patch: Parameters<OrderStore['updateOrder']>[1]) {
    await this.db.update(orders).set({ ...patch, updatedAt: new Date() }).where(eq(orders.id, orderId));
  }

  async replaceGuests(orderId: string, guests: { fullName: string; birthdate: string | null; passengerType: PassengerType | null }[]) {
    await this.db.delete(orderGuests).where(eq(orderGuests.orderId, orderId));
    if (guests.length) await this.db.insert(orderGuests).values(guests.map((g) => ({ ...g, orderId })));
  }

  async findGuests(orderId: string) {
    const rows = await this.db.select({ fullName: orderGuests.fullName, passengerType: orderGuests.passengerType }).from(orderGuests).where(eq(orderGuests.orderId, orderId));
    const typeRank = (type: string | null) => (type === 'infant' ? 2 : type === 'child' ? 1 : 0);
    return rows.map((row) => ({ fullName: row.fullName, passengerType: row.passengerType as PassengerType | null })).sort((a, b) => typeRank(a.passengerType) - typeRank(b.passengerType));
  }

  async findGuestBirthdates(orderId: string) {
    return (await this.db.select({ birthdate: orderGuests.birthdate }).from(orderGuests).where(eq(orderGuests.orderId, orderId))).map((g) => g.birthdate);
  }

  async holdCell(cell: InventoryCell) {
    const rows =
      cell.productType === 'room'
        ? await this.db
            .update(roomInventory)
            .set({ held: sql`${roomInventory.held} + ${cell.qty}` })
            .where(and(eq(roomInventory.roomTypeId, cell.productId), eq(roomInventory.date, cell.date), eq(roomInventory.stopSell, false), sql`${roomInventory.total} - ${roomInventory.held} - ${roomInventory.sold} >= ${cell.qty}`))
            .returning({ date: roomInventory.date })
        : await this.db
            .update(flightInventory)
            .set({ held: sql`${flightInventory.held} + ${cell.qty}` })
            .where(and(eq(flightInventory.flightId, cell.productId), eq(flightInventory.date, cell.date), eq(flightInventory.stopSell, false), sql`${flightInventory.total} - ${flightInventory.held} - ${flightInventory.sold} >= ${cell.qty}`))
            .returning({ date: flightInventory.date });
    return rows.length === 1;
  }

  async releaseCell(cell: InventoryCell) {
    if (cell.productType === 'room') {
      await this.db
        .update(roomInventory)
        .set({ held: sql`greatest(0, ${roomInventory.held} - ${cell.qty})` })
        .where(and(eq(roomInventory.roomTypeId, cell.productId), eq(roomInventory.date, cell.date)));
    } else {
      await this.db
        .update(flightInventory)
        .set({ held: sql`greatest(0, ${flightInventory.held} - ${cell.qty})` })
        .where(and(eq(flightInventory.flightId, cell.productId), eq(flightInventory.date, cell.date)));
    }
  }

  async unsellCell(cell: InventoryCell) {
    if (cell.productType === 'room') {
      await this.db
        .update(roomInventory)
        .set({ sold: sql`greatest(0, ${roomInventory.sold} - ${cell.qty})` })
        .where(and(eq(roomInventory.roomTypeId, cell.productId), eq(roomInventory.date, cell.date)));
    } else {
      await this.db
        .update(flightInventory)
        .set({ sold: sql`greatest(0, ${flightInventory.sold} - ${cell.qty})` })
        .where(and(eq(flightInventory.flightId, cell.productId), eq(flightInventory.date, cell.date)));
    }
  }

  async sellCell(cell: InventoryCell) {
    const rows =
      cell.productType === 'room'
        ? await this.db
            .update(roomInventory)
            .set({ held: sql`${roomInventory.held} - ${cell.qty}`, sold: sql`${roomInventory.sold} + ${cell.qty}` })
            .where(and(eq(roomInventory.roomTypeId, cell.productId), eq(roomInventory.date, cell.date), sql`${roomInventory.held} >= ${cell.qty}`))
            .returning({ date: roomInventory.date })
        : await this.db
            .update(flightInventory)
            .set({ held: sql`${flightInventory.held} - ${cell.qty}`, sold: sql`${flightInventory.sold} + ${cell.qty}` })
            .where(and(eq(flightInventory.flightId, cell.productId), eq(flightInventory.date, cell.date), sql`${flightInventory.held} >= ${cell.qty}`))
            .returning({ date: flightInventory.date });
    return rows.length === 1;
  }

  async insertPayment(payment: { orderId: string; userId: string; gatewayKey: string; amount: number; gateway: string }) {
    const [row] = await this.db.insert(payments).values(payment).returning({ id: payments.id });
    return row!.id;
  }

  async lockPaymentByKey(gatewayKey: string) {
    const [row] = await this.db.select().from(payments).where(eq(payments.gatewayKey, gatewayKey)).for('update');
    return row ? mapPayment(row) : null;
  }

  async findPaymentsByKey(gatewayKey: string) {
    return (await this.db.select().from(payments).where(eq(payments.gatewayKey, gatewayKey)).limit(1)).map(mapPayment);
  }

  async findPaymentByChallenge(orderId: string, challengeId: string) {
    const [row] = await this.db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.challengeId, challengeId))).limit(1);
    return row ? mapPayment(row) : null;
  }

  async findPaymentsOfOrder(orderId: string) {
    return (await this.db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt))).map(mapPayment);
  }

  async updatePayment(paymentId: string, patch: Parameters<OrderStore['updatePayment']>[1]) {
    await this.db.update(payments).set({ ...patch, updatedAt: new Date() }).where(eq(payments.id, paymentId));
  }

  async countFailedCharges(orderId: string) {
    const [row] = await this.db.select({ n: count() }).from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, 'failed')));
    return row?.n ?? 0;
  }

  async insertRefund(refund: { orderId: string; paymentId: string; gatewayKey: string; amount: number; reason: string; needsReview: boolean }) {
    await this.db.insert(refunds).values(refund).onConflictDoNothing({ target: refunds.gatewayKey });
  }

  private refundSelect() {
    return this.db
      .select({
        id: refunds.id,
        orderId: refunds.orderId,
        paymentId: refunds.paymentId,
        gatewayKey: refunds.gatewayKey,
        amount: refunds.amount,
        status: refunds.status,
        needsReview: refunds.needsReview,
        checkAttempts: refunds.checkAttempts,
        parentRef: payments.gatewayRef,
        parentGatewayKey: payments.gatewayKey,
        parentCreatedAt: payments.createdAt,
        parentAmount: payments.amount,
        gatewayRef: refunds.gatewayRef,
        gatewayBankCode: refunds.gatewayBankCode,
        gatewayRefundedAt: refunds.gatewayRefundedAt,
        updatedAt: refunds.updatedAt,
        gateway: payments.gateway,
      })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId));
  }

  async findInitiatedRefunds(orderId: string) {
    const rows = await this.refundSelect().where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'initiated')));
    return rows.map((r) => ({ ...r, status: r.status as RefundRecord['status'] }));
  }

  async findRefundsOfOrder(orderId: string) {
    const rows = await this.refundSelect().where(eq(refunds.orderId, orderId)).orderBy(asc(refunds.createdAt), asc(refunds.id));
    return rows.map((r) => ({ ...r, status: r.status as RefundRecord['status'] }));
  }

  async markRefundSucceeded(refundId: string, gatewayRef: string, metadata: Parameters<OrderStore['markRefundSucceeded']>[2] = {}) {
    await this.db.update(refunds).set({ status: 'succeeded', gatewayRef, ...metadata, updatedAt: new Date() }).where(and(eq(refunds.id, refundId), eq(refunds.status, 'initiated')));
  }

  async markRefundAccepted(refundId: string, gatewayRef: string) {
    await this.db.update(refunds).set({ gatewayRef, updatedAt: new Date() }).where(and(eq(refunds.id, refundId), eq(refunds.status, 'initiated')));
  }

  async markRefundSubmitted(refundId: string, gatewayRef: string | null, options?: Parameters<OrderStore['markRefundSubmitted']>[2]) {
    // Chỉ một tác vụ được chuyển từ chưa gửi sang đã gửi, kể cả lease cũ vừa hết hạn.
    const expectedRef = options ? options.expectedRef : gatewayRef === null ? SUBMITTED_REFUND_REF : null;
    const changed = await this.db.update(refunds).set({ gatewayRef, updatedAt: new Date() })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, 'initiated'), eq(refunds.needsReview, false), expectedRef === null ? sql`${refunds.gatewayRef} is null` : eq(refunds.gatewayRef, expectedRef), options ? eq(refunds.checkAttempts, options.checkAttempts) : undefined))
      .returning({ id: refunds.id });
    return changed.length === 1;
  }

  async claimDueCharges(input: { gateway: string; olderThanSeconds: number; limit: number; backoffSeconds: number[] }) {
    const due = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.status, 'initiated'), eq(payments.gateway, input.gateway), eq(payments.needsReview, false), sql`${payments.nextCheckAt} <= now()`, sql`${payments.updatedAt} < now() - make_interval(secs => ${input.olderThanSeconds})`))
      .orderBy(asc(payments.nextCheckAt))
      .limit(input.limit)
      .for('update', { skipLocked: true });
    for (const p of due) {
      const wait = input.backoffSeconds[Math.min(p.checkAttempts, input.backoffSeconds.length - 1)]!;
      await this.db
        .update(payments)
        .set({ checkAttempts: p.checkAttempts + 1, nextCheckAt: sql`now() + make_interval(secs => ${wait})` })
        .where(eq(payments.id, p.id));
    }
    return due.map((p) => ({ ...mapPayment(p), checkAttempts: p.checkAttempts + 1 }));
  }

  async claimDueRefunds(input: Parameters<OrderStore['claimDueRefunds']>[0]) {
    const due = await this.refundSelect()
      .where(and(eq(refunds.status, 'initiated'), input.gateway === undefined ? undefined : eq(payments.gateway, input.gateway), input.orderId === undefined ? undefined : eq(refunds.orderId, input.orderId), eq(refunds.needsReview, false), sql`${refunds.nextCheckAt} <= now()`, sql`${refunds.updatedAt} < now() - make_interval(secs => ${input.olderThanSeconds})`))
      .orderBy(asc(refunds.nextCheckAt))
      .limit(input.limit)
      .for('update', { of: refunds, skipLocked: true });
    for (const r of due) {
      const wait = input.backoffSeconds[Math.min(r.checkAttempts, input.backoffSeconds.length - 1)]!;
      await this.db
        .update(refunds)
        .set({ checkAttempts: r.checkAttempts + 1, nextCheckAt: sql`now() + make_interval(secs => ${wait})` })
        .where(eq(refunds.id, r.id));
    }
    return due.map((r) => ({ ...r, status: r.status as RefundRecord['status'], checkAttempts: r.checkAttempts + 1 }));
  }

  async markForReview(kind: 'charge' | 'refund', id: string) {
    if (kind === 'charge') await this.db.update(payments).set({ needsReview: true }).where(eq(payments.id, id));
    else await this.db.update(refunds).set({ needsReview: true }).where(eq(refunds.id, id));
  }
}
