import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { COMMERCE_STORE, TODAY, type CommerceStore, type Today } from '../../inventory/application/ports.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { MAX_ADULTS, MAX_NIGHTS, addDays, countNights, isIsoDate, quoteFlight, quoteStay, type PricePlan } from '../../inventory/domain/sales-rules.js';
import {
  HOLD_MINUTES,
  HOLDS_PER_HOUR,
  MAX_ITEMS_PER_ORDER,
  POLICY_VERSION,
  findInvalidGuestFields,
  hasCompleteGuests,
  isHoldExpired,
  type ContactInput,
  type OrderStatus,
  type GuestInput,
} from '../domain/order-rules.js';
import { COMMERCE_CLOCK, ORDER_STORE, type Clock, type InventoryCell, type NewOrderItem, type OrderItemRecord, type OrderRecord, type OrderStore } from './ports.js';

export interface CheckoutItemInput {
  /** Mã loại phòng hoặc mã hạng ghế (productId trong danh mục). */
  productId: string;
  checkIn: string;
  /** Bắt buộc với phòng. */
  checkOut?: string;
  /** Số phòng; vé bay luôn bằng số khách. */
  qty?: number;
  ratePlanCode?: string;
}

export interface CheckoutInput {
  adults: number;
  items: CheckoutItemInput[];
  sourcePostId?: string | null;
}

export interface CheckoutView {
  orderId: string;
  status: OrderRecord['status'];
  holdExpiresAt: string;
  total: number;
  adults: number;
  confirmationCode: string | null;
  cancelReason: string | null;
  items: (Omit<OrderItemRecord, 'orderId'> & { dateTo: string })[];
  isGuestInfoComplete: boolean;
  passengersRequired: number;
  policyVersion: string;
}

export interface TripView {
  orderId: string;
  status: OrderRecord['status'];
  total: number;
  adults: number;
  confirmationCode: string | null;
  cancelReason: string | null;
  holdExpiresAt: string;
  createdAt: string;
  paidAt: string | null;
  /** Ngày sớm nhất / muộn nhất của các mục (nhận phòng, bay; trả phòng). */
  startDate: string | null;
  endDate: string | null;
  items: CheckoutView['items'];
}

export interface TripPage {
  trips: TripView[];
  nextCursor: string | null;
}

export interface ListTripsQuery {
  statuses?: OrderStatus[];
  cursor?: string | null;
  limit?: number;
}

export const TRIPS_DEFAULT_LIMIT = 20;
export const TRIPS_MAX_LIMIT = 50;

/** Con trỏ trang: (createdAt, id) của đơn cuối trang trước, base64url để client coi là chuỗi mờ. */
export const encodeTripCursor = (order: { createdAt: Date; id: string }) => Buffer.from(JSON.stringify([order.createdAt.toISOString(), order.id])).toString('base64url');
export const decodeTripCursor = (cursor: string): { createdAt: Date; id: string } => {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    const date = new Date(String(createdAt));
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && !Number.isNaN(date.getTime())) return { createdAt: date, id };
  } catch {
    // Rơi xuống lỗi bên dưới.
  }
  throw new CommerceError('invalid_query', 'Con trỏ trang không hợp lệ.');
};

const toItemViews = (items: OrderItemRecord[]): CheckoutView['items'] =>
  items.map(({ orderId: _orderId, ...i }) => ({ ...i, propertyName: i.propertyName ?? null, dateTo: i.productType === 'room' ? addDays(i.date, i.nights) : i.date }));

/** Giá hiện tại của một mục, đọc từ lịch trống (không tin giá client gửi). */
export interface PricedItem extends NewOrderItem {
  cells: InventoryCell[];
}

const cellsOf = (item: { productType: 'room' | 'flight'; productId: string; date: string; nights: number; qty: number }): InventoryCell[] =>
  Array.from({ length: item.nights }, (_, i) => ({ productType: item.productType, productId: item.productId, date: addDays(item.date, i), qty: item.qty }));

/** Sắp xếp ô theo (sản phẩm, ngày) trước khi giữ: hai giỏ chạy cùng lúc khoá theo cùng thứ tự nên không deadlock. */
const sortCells = (cells: InventoryCell[]) => [...cells].sort((a, b) => a.productId.localeCompare(b.productId) || a.date.localeCompare(b.date));

/** Mọi ô của đơn, đúng thứ tự khoá ở trên: giữ, nhả và bán chạy cùng lúc đều không deadlock. */
export const listSortedCells = (items: OrderItemRecord[]) => sortCells(items.flatMap(cellsOf));

/**
 * Giữ chỗ và tạo đơn (TF29, docs/10 §3.4, không saga): giữ mọi mục + tạo đơn pending trong một transaction,
 * thiếu một ô thì rollback cả giỏ. Hết hạn sau 30 phút, ExpireHoldsJob nhả chỗ.
 */
@Injectable()
export class CheckoutUseCases {
  constructor(
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(COMMERCE_STORE) private readonly catalog: CommerceStore,
    @Inject(TODAY) private readonly today: Today,
    @Inject(COMMERCE_CLOCK) private readonly now: Clock,
  ) {}

  async checkout(userId: string, input: CheckoutInput): Promise<CheckoutView> {
    const orderId = await this.holdAndCreateOrder(userId, input);
    return this.getCheckout(userId, orderId);
  }

  @Transactional('commerce')
  private async holdAndCreateOrder(userId: string, input: CheckoutInput): Promise<string> {
    if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > MAX_ADULTS) throw new CommerceError('invalid_query', `Số khách từ 1 đến ${MAX_ADULTS}.`, 'adults');
    if (!input.items.length || input.items.length > MAX_ITEMS_PER_ORDER) throw new CommerceError('invalid_query', `Giỏ có từ 1 đến ${MAX_ITEMS_PER_ORDER} mục.`, 'items');
    const priced = await this.priceItems(input.items, input.adults);

    await this.orders.lockUser(userId);
    const now = this.now();
    if ((await this.orders.countOrdersCreatedSince(userId, new Date(now.getTime() - 3_600_000))) >= HOLDS_PER_HOUR) {
      throw new CommerceError('rate_limited', 'Bạn giữ chỗ quá nhiều lần, vui lòng thử lại sau.');
    }
    const active = await this.orders.lockOrdersOfUser(userId, ['pending', 'paying']);
    // Đơn đang chờ cổng trả kết quả thì chưa cho giữ giỏ mới: nếu thẻ bị từ chối, đơn đó phải quay về pending được.
    if (active.some((o) => o.status === 'paying' && !isHoldExpired(o.holdExpiresAt, now))) {
      throw new CommerceError('conflict', 'Bạn có một đơn đang thanh toán, vui lòng chờ kết quả trước khi giữ giỏ mới.');
    }
    // Mỗi tài khoản một giỏ đang giữ: giữ giỏ mới thì nhả giỏ cũ.
    for (const old of active.filter((o) => o.status === 'pending')) {
      await this.releaseOrder(old.id, 'cancelled', 'Đã giữ giỏ mới');
    }

    for (const cell of sortCells(priced.flatMap((p) => p.cells))) {
      if (!(await this.orders.holdCell(cell))) {
        const item = priced.find((p) => p.productId === cell.productId)!;
        throw new CommerceError('conflict', `${item.productName} ngày ${cell.date} không đủ chỗ.`, 'items', { reason: 'SOLD_OUT', productId: cell.productId, date: cell.date });
      }
    }
    const total = priced.reduce((sum, p) => sum + p.lineTotal, 0);
    const orderId = await this.orders.insertOrder({
      userId,
      total,
      adults: input.adults,
      sourcePostId: input.sourcePostId ?? null,
      holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
    });
    await this.orders.insertItems(orderId, priced.map(({ cells: _cells, ...item }) => item));
    return orderId;
  }

  /** Tính giá và kiểm luật bán từng mục từ lịch trống; một mục không đặt được thì báo lý do, chưa giữ gì. */
  async priceItems(items: CheckoutItemInput[], adults: number): Promise<PricedItem[]> {
    const ids = items.map((i) => i.productId);
    const [roomTypes, flights] = await Promise.all([this.catalog.catalog.findRoomTypesByIds(ids), this.catalog.catalog.findFlightsByIds(ids)]);
    const today = this.today();
    const out: PricedItem[] = [];
    for (const item of items) {
      if (!isIsoDate(item.checkIn) || item.checkIn < today) throw new CommerceError('invalid_query', 'Ngày nhận phòng / ngày bay phải từ hôm nay trở đi.', 'checkIn');
      const room = roomTypes.find((r) => r.id === item.productId);
      const flight = flights.find((f) => f.id === item.productId);
      if (room) {
        if (!isIsoDate(item.checkOut) || item.checkOut <= item.checkIn || countNights(item.checkIn, item.checkOut) > MAX_NIGHTS) {
          throw new CommerceError('invalid_query', `Ngày trả phòng phải sau ngày nhận phòng, ở tối đa ${MAX_NIGHTS} đêm.`, 'checkOut');
        }
        const qty = item.qty ?? Math.ceil(adults / room.maxGuests);
        if (!Number.isInteger(qty) || qty < 1 || qty > 9) throw new CommerceError('invalid_query', 'Số phòng từ 1 đến 9.', 'qty');
        if (qty * room.maxGuests < adults) throw new CommerceError('conflict', `${room.name}: ${adults} khách cần ít nhất ${Math.ceil(adults / room.maxGuests)} phòng.`, 'qty', { reason: 'NOT_ENOUGH_ROOMS', productId: room.id });
        const plan = this.findPlan(room.ratePlans, item.ratePlanCode);
        const days = (await this.catalog.calendar.loadRoomDays([room.id], item.checkIn, item.checkOut)).get(room.id) ?? [];
        const quote = quoteStay({ days, checkIn: item.checkIn, checkOut: item.checkOut, rooms: qty, plan });
        if (!quote.isAvailable) throw new CommerceError('conflict', `${room.name}: không đặt được (${quote.reason}).`, 'items', { reason: quote.reason, productId: room.id });
        const nights = countNights(item.checkIn, item.checkOut);
        out.push(this.toPriced({ productType: 'room', productId: room.id, productName: room.name, date: item.checkIn, nights, qty, lineTotal: quote.totalPrice, plan }));
      } else if (flight) {
        const plan = this.findPlan(flight.farePlans, item.ratePlanCode);
        const day = ((await this.catalog.calendar.loadFlightDays([flight.id], item.checkIn, item.checkIn)).get(flight.id) ?? [])[0];
        const quote = quoteFlight({ day, passengers: adults, plan });
        if (!quote.isAvailable) throw new CommerceError('conflict', `${flight.name}: không đặt được (${quote.reason}).`, 'items', { reason: quote.reason, productId: flight.id });
        out.push(this.toPriced({ productType: 'flight', productId: flight.id, productName: `${flight.name} · ${flight.cabinName}`, date: item.checkIn, nights: 1, qty: adults, lineTotal: quote.totalPrice, plan }));
      } else {
        throw new CommerceError('not_found', `Không có sản phẩm ${item.productId}.`, 'items');
      }
    }
    return out;
  }

  private findPlan(plans: PricePlan[], code: string | undefined): PricePlan {
    const plan = code ? plans.find((p) => p.code === code) : plans[0];
    if (!plan) throw new CommerceError('invalid_query', `Không có gói giá ${code}.`, 'ratePlanCode');
    return plan;
  }

  private toPriced(i: { productType: 'room' | 'flight'; productId: string; productName: string; date: string; nights: number; qty: number; lineTotal: number; plan: PricePlan }): PricedItem {
    const item = {
      productType: i.productType,
      productId: i.productId,
      productName: i.productName,
      date: i.date,
      nights: i.nights,
      qty: i.qty,
      unitPrice: Math.round(i.lineTotal / i.qty / i.nights),
      lineTotal: i.lineTotal,
      ratePlanCode: i.plan.code,
      ratePlanName: i.plan.name,
      isRefundable: i.plan.refundable,
      freeCancelUntil: i.plan.refundable ? addDays(i.date, -i.plan.freeCancelDays) : null,
    };
    return { ...item, cells: cellsOf(item) };
  }

  /** Trả chỗ của cả đơn về kho và đổi trạng thái. Dùng trong transaction đang mở. */
  async releaseOrder(orderId: string, status: 'cancelled' | 'expired', reason: string): Promise<void> {
    for (const cell of listSortedCells(await this.orders.findItems(orderId))) await this.orders.releaseCell(cell);
    await this.orders.updateOrder(orderId, { status, cancelReason: reason, cancelledAt: this.now() });
  }

  @Transactional('commerce')
  async setGuests(userId: string, orderId: string, input: { contact: ContactInput; guests: GuestInput[] }): Promise<{ orderId: string; isGuestInfoComplete: true }> {
    const order = await this.ownOrder(userId, orderId, { lock: true });
    if (order.status === 'paying') throw new CommerceError('conflict', 'Đơn đang được thanh toán, không sửa thông tin khách được.');
    this.assertPending(order);
    const passengersRequired = (await this.orders.findItems(orderId)).some((i) => i.productType === 'flight') ? order.adults : 0;
    const invalid = findInvalidGuestFields({ ...input, passengersRequired, today: this.today() });
    if (invalid.length) throw new CommerceError('invalid_query', 'Thông tin khách chưa đủ hoặc chưa đúng.', invalid[0], { fields: invalid, passengersRequired });
    await this.orders.updateOrder(orderId, { contactName: input.contact.fullName.trim(), contactPhone: input.contact.phone.replace(/\s/g, ''), contactEmail: input.contact.email?.trim() || null });
    await this.orders.replaceGuests(orderId, input.guests.filter((g) => g.fullName.trim()).map((g) => ({ fullName: g.fullName.trim(), birthdate: g.birthdate })));
    return { orderId, isGuestInfoComplete: true };
  }

  @Transactional('commerce')
  async cancelHold(userId: string, orderId: string): Promise<{ orderId: string; status: 'cancelled' }> {
    const order = await this.ownOrder(userId, orderId, { lock: true });
    if (order.status === 'pending') await this.releaseOrder(orderId, 'cancelled', 'Người dùng huỷ');
    else if (order.status !== 'cancelled') throw new CommerceError('conflict', 'Chỉ huỷ được giỏ đang giữ chỗ.');
    return { orderId, status: 'cancelled' };
  }

  async getCheckout(userId: string, orderId: string): Promise<CheckoutView> {
    const order = await this.ownOrder(userId, orderId);
    const items = await this.orders.findItems(orderId);
    const passengersRequired = items.some((i) => i.productType === 'flight') ? order.adults : 0;
    return {
      orderId: order.id,
      status: order.status,
      holdExpiresAt: order.holdExpiresAt.toISOString(),
      total: order.total,
      adults: order.adults,
      confirmationCode: order.confirmationCode,
      cancelReason: order.cancelReason,
      items: toItemViews(items),
      isGuestInfoComplete: hasCompleteGuests({ contactName: order.contactName, contactPhone: order.contactPhone, guestBirthdates: await this.orders.findGuestBirthdates(orderId), passengersRequired }),
      passengersRequired,
      policyVersion: POLICY_VERSION,
    };
  }

  /** Chuyến đi của tôi (TF37): mọi đơn của người gọi, mới nhất trước; web và app đọc cùng một nguồn nên đặt xong là thấy. */
  async listTrips(userId: string, query: ListTripsQuery = {}): Promise<TripPage> {
    const limit = Math.min(Math.max(query.limit ?? TRIPS_DEFAULT_LIMIT, 1), TRIPS_MAX_LIMIT);
    const after = query.cursor ? decodeTripCursor(query.cursor) : undefined;
    const rows = await this.orders.listOrdersOfUser({ userId, statuses: query.statuses, after, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const itemsByOrder = new Map<string, OrderItemRecord[]>();
    for (const item of await this.orders.findItemsOfOrders(page.map((o) => o.id))) {
      itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item]);
    }
    const trips = page.map((order): TripView => {
      const items = toItemViews(itemsByOrder.get(order.id) ?? []);
      return {
        orderId: order.id,
        status: order.status,
        total: order.total,
        adults: order.adults,
        confirmationCode: order.confirmationCode,
        cancelReason: order.cancelReason,
        holdExpiresAt: order.holdExpiresAt.toISOString(),
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        startDate: items.reduce<string | null>((min, i) => (min === null || i.date < min ? i.date : min), null),
        endDate: items.reduce<string | null>((max, i) => (max === null || i.dateTo > max ? i.dateTo : max), null),
        items,
      };
    });
    const last = page.at(-1);
    return { trips, nextCursor: rows.length > limit && last ? encodeTripCursor(last) : null };
  }

  /** Đơn của đúng người dùng; đơn của người khác trả 404 như không tồn tại, không lộ là có. */
  async ownOrder(userId: string, orderId: string, options: { lock?: boolean } = {}): Promise<OrderRecord> {
    const order = options.lock ? await this.orders.lockOrder(orderId) : await this.orders.findOrder(orderId);
    if (!order || order.userId !== userId) throw new CommerceError('not_found', 'Không có đơn này.');
    return order;
  }

  /** Còn giữ chỗ (pending, chưa hết hạn) không; không thì ném lỗi rõ vì sao. */
  assertPending(order: OrderRecord): void {
    if (order.status === 'cancelled') throw new CommerceError('gone', order.cancelReason ? `Giỏ đã huỷ: ${order.cancelReason}.` : 'Giỏ đã huỷ.');
    if (order.status === 'expired' || (order.status === 'pending' && isHoldExpired(order.holdExpiresAt, this.now()))) throw new CommerceError('gone', 'Hết thời gian giữ chỗ.');
    if (order.status !== 'pending') throw new CommerceError('conflict', 'Đơn không còn ở trạng thái chờ thanh toán.');
  }
}
