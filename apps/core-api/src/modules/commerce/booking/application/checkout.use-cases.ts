import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { COMMERCE_STORE, TODAY, type CommerceStore, type Today } from '../../inventory/application/ports.js';
import { CommerceError } from '../../inventory/domain/errors.js';
import { MAX_NIGHTS, addDays, calculatePassengerFares, countNights, countSeats, findPassengerMixError, isIsoDate, quoteFlight, quoteStay, type PassengerMix, type PricePlan } from '../../inventory/domain/sales-rules.js';
import {
  HOLD_MINUTES,
  HOLDS_PER_HOUR,
  MAX_ITEMS_PER_ORDER,
  POLICY_VERSION,
  hasCompleteGuests,
  isHoldExpired,
  listGuestFieldErrors,
  listPassengerTypes,
  type ContactInput,
  type PassengerType,
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
  /** Số phòng; vé bay luôn bằng số ghế (người lớn + trẻ em). */
  qty?: number;
  ratePlanCode?: string;
}

export interface CheckoutInput {
  adults: number;
  /** Chỉ dùng cho vé bay: trẻ em chiếm ghế, giá 75%; em bé ngồi lòng người lớn, giá 10%. */
  children?: number;
  infants?: number;
  items: CheckoutItemInput[];
  sourcePostId?: string | null;
}

export interface CheckoutView {
  orderId: string;
  status: OrderRecord['status'];
  holdExpiresAt: string;
  total: number;
  adults: number;
  children: number;
  infants: number;
  confirmationCode: string | null;
  cancelReason: string | null;
  items: (Omit<OrderItemRecord, 'orderId'> & { dateTo: string })[];
  isGuestInfoComplete: boolean;
  passengersRequired: number;
  /** Loại của từng hành khách cần nhập, đúng thứ tự gửi guests; rỗng khi không có vé bay. */
  passengerTypes: PassengerType[];
  policyVersion: string;
}

export interface TripView {
  orderId: string;
  status: OrderRecord['status'];
  total: number;
  adults: number;
  children: number;
  infants: number;
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

/** Nhóm hành khách đã lưu của đơn. */
export const passengerMixOf = (order: Pick<OrderRecord, 'adults' | 'children' | 'infants'>): PassengerMix => ({ adults: order.adults, children: order.children, infants: order.infants });

/** Hành khách phải nhập: có vé bay thì mọi người lớn, trẻ em, em bé; chỉ có phòng thì không ai. */
export const listRequiredPassengers = (order: Pick<OrderRecord, 'adults' | 'children' | 'infants'>, items: Pick<OrderItemRecord, 'productType'>[]): PassengerType[] =>
  items.some((i) => i.productType === 'flight') ? listPassengerTypes(passengerMixOf(order)) : [];

/** Ngày bay đầu và cuối của đơn: tuổi từng loại khách xét theo cả chuyến (khứ hồi có thể qua sinh nhật). */
function findTravelDates(items: Pick<OrderItemRecord, 'productType' | 'date'>[]): { first: string; last: string } | undefined {
  const dates = items.filter((i) => i.productType === 'flight').map((i) => i.date).sort();
  return dates.length ? { first: dates[0]!, last: dates.at(-1)! } : undefined;
}

const toItemViews = (items: OrderItemRecord[]): CheckoutView['items'] =>
  items.map(({ orderId: _orderId, ...i }) => ({ ...i, propertyName: i.propertyName ?? null, dateTo: i.productType === 'room' ? addDays(i.date, i.nights) : i.date }));

/** Giá hiện tại của một mục, đọc từ lịch trống (không tin giá client gửi). */
export interface PricedItem extends NewOrderItem {
  cells: InventoryCell[];
}

/** Transaction chờ khoá vẫn giữ một kết nối: chờ quá lâu thì nhiều người tranh một phòng sẽ làm hết pool của commerce. */
const HOLD_LOCK_WAIT_MS = 2_000;

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
    const orderId = await this.holdAndCreateOrder(userId, input).catch((error: unknown) => {
      if (this.orders.isLockWaitTimeout(error)) throw new CommerceError('conflict', 'Đang có nhiều người đặt cùng lúc, vui lòng thử lại.', 'items', { reason: 'LOCK_TIMEOUT' });
      throw error;
    });
    return this.getCheckout(userId, orderId);
  }

  @Transactional('commerce')
  private async holdAndCreateOrder(userId: string, input: CheckoutInput): Promise<string> {
    const mix = { adults: input.adults, children: input.children ?? 0, infants: input.infants ?? 0 };
    const mixError = findPassengerMixError(mix);
    if (mixError) throw new CommerceError('invalid_query', mixError.message, mixError.field);
    if (!input.items.length || input.items.length > MAX_ITEMS_PER_ORDER) throw new CommerceError('invalid_query', `Giỏ có từ 1 đến ${MAX_ITEMS_PER_ORDER} mục.`, 'items');
    const priced = await this.priceItems(input.items, mix);
    // Phòng chỉ tính theo người lớn: trẻ em, em bé chỉ có nghĩa khi giỏ có vé bay.
    if ((mix.children > 0 || mix.infants > 0) && !priced.some((p) => p.productType === 'flight')) {
      throw new CommerceError('invalid_query', 'Trẻ em và em bé chỉ áp dụng cho vé máy bay.', mix.children > 0 ? 'children' : 'infants');
    }

    await this.orders.limitLockWait(HOLD_LOCK_WAIT_MS);
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
      ...mix,
      sourcePostId: input.sourcePostId ?? null,
      holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
    });
    await this.orders.insertItems(orderId, priced.map(({ cells: _cells, ...item }) => item));
    return orderId;
  }

  /**
   * Tính giá và kiểm luật bán từng mục từ lịch trống; một mục không đặt được thì báo lý do, chưa giữ gì.
   * Phòng tính theo người lớn như trước; vé bay giữ ghế cho người lớn + trẻ em và tính giá cả em bé.
   */
  async priceItems(items: CheckoutItemInput[], mix: PassengerMix): Promise<PricedItem[]> {
    const { adults } = mix;
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
        out.push(this.toPriced({ productType: 'room', productId: room.id, productName: room.name, date: item.checkIn, nights, qty, lineTotal: quote.totalPrice, unitPrice: Math.round(quote.totalPrice / qty / nights), plan }));
      } else if (flight) {
        const plan = this.findPlan(flight.farePlans, item.ratePlanCode);
        const day = ((await this.catalog.calendar.loadFlightDays([flight.id], item.checkIn, item.checkIn)).get(flight.id) ?? [])[0];
        const quote = quoteFlight({ day, passengers: adults, children: mix.children, infants: mix.infants, plan });
        if (!quote.isAvailable) throw new CommerceError('conflict', `${flight.name}: không đặt được (${quote.reason}).`, 'items', { reason: quote.reason, productId: flight.id });
        // Đơn giá vé bay là giá người lớn, kèm giá trẻ em, em bé: lineTotal / qty không phải giá của loại khách nào.
        const fares = calculatePassengerFares(quote.pricePerNight);
        out.push(
          this.toPriced({
            productType: 'flight',
            productId: flight.id,
            productName: `${flight.name} · ${flight.cabinName}`,
            date: item.checkIn,
            nights: 1,
            qty: countSeats(mix),
            lineTotal: quote.totalPrice,
            unitPrice: fares.adult,
            childUnitPrice: fares.child,
            infantUnitPrice: fares.infant,
            plan,
          }),
        );
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

  private toPriced(i: {
    productType: 'room' | 'flight';
    productId: string;
    productName: string;
    date: string;
    nights: number;
    qty: number;
    lineTotal: number;
    unitPrice: number;
    childUnitPrice?: number;
    infantUnitPrice?: number;
    plan: PricePlan;
  }): PricedItem {
    const item = {
      productType: i.productType,
      productId: i.productId,
      productName: i.productName,
      date: i.date,
      nights: i.nights,
      qty: i.qty,
      unitPrice: i.unitPrice,
      childUnitPrice: i.childUnitPrice ?? null,
      infantUnitPrice: i.infantUnitPrice ?? null,
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
    const items = await this.orders.findItems(orderId);
    const passengerTypes = listRequiredPassengers(order, items);
    const passengersRequired = passengerTypes.length;
    const errors = listGuestFieldErrors({ ...input, passengersRequired, today: this.today(), passengerTypes, travelDates: findTravelDates(items) });
    // Trả mọi trường sai kèm câu cụ thể để client báo đúng ô, không chỉ một câu chung.
    if (errors.length)
      throw new CommerceError('invalid_query', 'Thông tin khách chưa đủ hoặc chưa đúng.', errors[0]!.field, { errors, fields: errors.map((e) => e.field), passengersRequired });
    await this.orders.updateOrder(orderId, { contactName: input.contact.fullName.trim(), contactPhone: input.contact.phone.replace(/\s/g, ''), contactEmail: input.contact.email?.trim() || null });
    // Lưu loại khách cùng từng người, để xuất vé, email, chuyến đi của tôi không phải dựa vào thứ tự.
    await this.orders.replaceGuests(
      orderId,
      input.guests
        .map((g, i) => ({ fullName: g.fullName.trim(), birthdate: g.birthdate, passengerType: passengerTypes[i] ?? null }))
        .filter((g) => g.fullName),
    );
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
    const passengerTypes = listRequiredPassengers(order, items);
    const passengersRequired = passengerTypes.length;
    return {
      orderId: order.id,
      status: order.status,
      holdExpiresAt: order.holdExpiresAt.toISOString(),
      total: order.total,
      adults: order.adults,
      children: order.children,
      infants: order.infants,
      confirmationCode: order.confirmationCode,
      cancelReason: order.cancelReason,
      items: toItemViews(items),
      isGuestInfoComplete: hasCompleteGuests({ contactName: order.contactName, contactPhone: order.contactPhone, guestBirthdates: await this.orders.findGuestBirthdates(orderId), passengersRequired }),
      passengersRequired,
      passengerTypes,
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
        children: order.children,
        infants: order.infants,
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
