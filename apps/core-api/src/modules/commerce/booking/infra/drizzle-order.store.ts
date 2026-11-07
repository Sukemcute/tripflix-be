import { Injectable } from '@nestjs/common';
import { InjectTransactionHost, type Db } from '@tripflix/db';
import { and, asc, count, desc, eq, exists, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { flightInventory, orderGuests, orderItems, orders, payments, properties, refunds, roomInventory, roomTypes, type OrderItemRow, type OrderRow, type PaymentRow } from '../../db/schema/index.js';
import type { OrderStatus } from '../domain/order-rules.js';
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
  failureCode: row.failureCode,
  cardLast4: row.cardLast4,
  challengeId: row.challengeId,
  checkAttempts: row.checkAttempts,
  createdAt: row.createdAt,
});

@Injectable()
export class DrizzleOrderStore implements OrderStore {
  constructor(@InjectTransactionHost('commerce') private readonly host: OrderDbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

  async lockUser(userId: string) {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
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

  async listOrdersOfUser(input: { userId: string; statuses?: OrderStatus[]; after?: { createdAt: Date; id: string }; limit: number }) {
    // Postgres giữ tới micro giây, Date của JS chỉ tới mili giây: so và sắp theo mili giây để con trỏ không bỏ sót đơn.
    const createdAtMs = sql`date_trunc('milliseconds', ${orders.createdAt})`;
    const rows = await this.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, input.userId),
          input.statuses?.length ? inArray(orders.status, input.statuses) : undefined,
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

  async updateItemPrices(prices: { id: string; unitPrice: number; lineTotal: number }[]) {
    for (const p of prices) await this.db.update(orderItems).set({ unitPrice: p.unitPrice, lineTotal: p.lineTotal }).where(eq(orderItems.id, p.id));
  }

  async setItemConfirmationCodes(codes: { id: string; code: string }[]) {
    for (const c of codes) await this.db.update(orderItems).set({ confirmationCode: c.code }).where(eq(orderItems.id, c.id));
  }

  async updateOrder(orderId: string, patch: Parameters<OrderStore['updateOrder']>[1]) {
    await this.db.update(orders).set({ ...patch, updatedAt: new Date() }).where(eq(orders.id, orderId));
  }

  async replaceGuests(orderId: string, guests: { fullName: string; birthdate: string | null }[]) {
    await this.db.delete(orderGuests).where(eq(orderGuests.orderId, orderId));
    if (guests.length) await this.db.insert(orderGuests).values(guests.map((g) => ({ ...g, orderId })));
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
        checkAttempts: refunds.checkAttempts,
        parentRef: payments.gatewayRef,
        gateway: payments.gateway,
      })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId));
  }

  async findInitiatedRefunds(orderId: string) {
    const rows = await this.refundSelect().where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'initiated')));
    return rows.map((r) => ({ ...r, status: r.status as RefundRecord['status'] }));
  }

  async markRefundSucceeded(refundId: string, gatewayRef: string) {
    await this.db.update(refunds).set({ status: 'succeeded', gatewayRef, updatedAt: new Date() }).where(eq(refunds.id, refundId));
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

  async claimDueRefunds(input: { gateway: string; olderThanSeconds: number; limit: number; backoffSeconds: number[] }) {
    const due = await this.refundSelect()
      .where(and(eq(refunds.status, 'initiated'), eq(payments.gateway, input.gateway), eq(refunds.needsReview, false), sql`${refunds.nextCheckAt} <= now()`, sql`${refunds.updatedAt} < now() - make_interval(secs => ${input.olderThanSeconds})`))
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
