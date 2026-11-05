import { Injectable } from '@nestjs/common';
import { InjectTransactionHost, type Db } from '@tripflix/db';
import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { flightInventory, orderGuests, orderItems, orders, payments, refunds, roomInventory, type OrderItemRow, type OrderRow, type PaymentRow } from '../../db/schema/index.js';
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

  async insertOrder(order: { userId: string; total: number; adults: number; sourcePostId: string | null; holdExpiresAt: Date }) {
    const [row] = await this.db.insert(orders).values(order).returning({ id: orders.id });
    return row!.id;
  }

  async insertItems(orderId: string, items: NewOrderItem[]) {
    if (items.length) await this.db.insert(orderItems).values(items.map((i) => ({ ...i, orderId })));
  }

  async findItems(orderId: string) {
    return (await this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.date), asc(orderItems.id))).map(mapItem);
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

  async insertRefund(refund: { orderId: string; paymentId: string; gatewayKey: string; amount: number; reason: string }) {
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
