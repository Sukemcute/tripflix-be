import { Inject, Injectable } from '@nestjs/common';
import { CommerceError } from '../domain/errors.js';
import {
  MAX_ADULTS,
  MAX_NIGHTS,
  MAX_ROOMS,
  addDays,
  calculatePlanPrice,
  countNights,
  countRemaining,
  countRoomsNeeded,
  isIsoDate,
  quoteFlight,
  quoteStay,
  type PricePlan,
  type StayQuote,
} from '../domain/sales-rules.js';
import type {
  AvailabilityResult,
  CatalogFlight,
  CatalogHotel,
  CatalogOption,
  CatalogPage,
  CheckAvailabilityQuery,
  ListCatalogQuery,
} from './catalog-types.js';
import { COMMERCE_STORE, MEDIA_URL, TODAY, keepMediaKey, type CommerceStore, type FlightRecord, type MediaUrl, type RoomTypeRecord, type Today } from './ports.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_DAYS = 93;
const DEFAULT_DAYS = 30;
const MAX_PRODUCT_IDS = 100;

const mapRatePlans = (plans: PricePlan[]) => plans.map((p) => ({ code: p.code, name: p.name, meal: p.meal, isRefundable: p.refundable }));
const minOrNull = (values: number[]) => (values.length ? Math.min(...values) : null);

/** Kết quả chưa có lựa chọn nào đặt được: giữ lý do của lựa chọn "gần được nhất" để discovery hiển thị. */
function toUnavailable(productId: string, reason: AvailabilityResult['reason'], remaining: number | null): AvailabilityResult {
  return { productId, isFound: true, isAvailable: false, optionId: null, reason, roomsNeeded: null, remaining, totalPrice: null, unitPrice: null, ratePlanCode: null };
}
const NOT_FOUND = (productId: string): AvailabilityResult => ({ ...toUnavailable(productId, null, null), isFound: false });

/**
 * Đọc danh mục và lịch trống cho module khác (discovery, trợ lý). Chỉ đọc, không mở transaction.
 * Mỗi trang vài câu query theo lô, không truy vấn từng sản phẩm.
 */
@Injectable()
export class CatalogUseCases {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(TODAY) private readonly today: Today,
    @Inject(MEDIA_URL) private readonly mediaUrl: MediaUrl = keepMediaKey,
  ) {}

  async listCatalog(query: ListCatalogQuery = {}): Promise<CatalogPage> {
    const type = query.type ?? 'hotel';
    if (type !== 'hotel' && type !== 'flight') throw new CommerceError('invalid_query', 'type phải là hotel hoặc flight.', 'type');
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new CommerceError('invalid_query', `limit từ 1 đến ${MAX_LIMIT}.`, 'limit');
    const days = query.days ?? DEFAULT_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new CommerceError('invalid_query', `days từ 1 đến ${MAX_DAYS}.`, 'days');
    const from = this.today();
    const to = addDays(from, days - 1);
    const cursor = query.cursor ?? undefined;
    return type === 'hotel'
      ? this.listHotels({ provinceSlug: query.provinceSlug, cursor, limit, from, to })
      : this.listFlightPage({ provinceSlug: query.provinceSlug, cursor, limit, from, to });
  }

  private async listHotels(q: { provinceSlug?: string; cursor?: string; limit: number; from: string; to: string }): Promise<CatalogPage> {
    const rows = await this.store.catalog.listProperties({ provinceSlug: q.provinceSlug, afterId: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const roomTypes = await this.store.catalog.findRoomTypesByPropertyIds(page.map((p) => p.id));
    const calendar = await this.store.calendar.loadRoomDays(roomTypes.map((r) => r.id), q.from, q.to);
    const items = page.map((p): CatalogHotel => {
      const options = roomTypes
        .filter((r) => r.propertyId === p.id)
        .map((r): CatalogOption => {
          const plan = r.ratePlans[0]!;
          const open = (calendar.get(r.id) ?? []).filter((d) => countRemaining(d) > 0);
          return {
            productId: r.id,
            name: r.name,
            maxGuests: r.maxGuests,
            basePrice: r.defaultPrice,
            priceFrom: minOrNull(open.map((d) => calculatePlanPrice(d.price, plan))),
            availableDays: open.length,
            ratePlans: mapRatePlans(r.ratePlans),
          };
        });
      const priceFrom = minOrNull(options.flatMap((o) => (o.priceFrom === null ? [] : [o.priceFrom])));
      return {
        type: 'hotel',
        id: p.id,
        slug: p.slug,
        name: p.name,
        province: { slug: p.provinceSlug, name: p.provinceName },
        city: p.city,
        stars: p.stars,
        brand: p.brand,
        style: p.style,
        thumbnail: p.thumbnail ? this.mediaUrl(p.thumbnail) : null,
        images: p.images.map(this.mediaUrl),
        priceFrom,
        isAvailable: priceFrom !== null,
        options,
        address: p.address ?? null,
        location: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
      };
    });
    return { from: q.from, to: q.to, items, nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  private async listFlightPage(q: { provinceSlug?: string; cursor?: string; limit: number; from: string; to: string }): Promise<CatalogPage> {
    const cabins = await this.store.catalog.listFlights({ destinationSlug: q.provinceSlug, afterKey: q.cursor, limit: q.limit + 1 });
    const keys = [...new Set(cabins.map((c) => c.flightKey))];
    const pageKeys = keys.slice(0, q.limit);
    const calendar = await this.store.calendar.loadFlightDays(cabins.map((c) => c.id), q.from, q.to);
    const items = pageKeys.map((key): CatalogFlight => {
      const group = cabins.filter((c) => c.flightKey === key);
      const first = group[0]!;
      const options = group.map((c): CatalogOption => {
        const plan = c.farePlans[0]!;
        const open = (calendar.get(c.id) ?? []).filter((d) => countRemaining(d) > 0);
        return {
          productId: c.id,
          name: c.cabinName,
          maxGuests: 1,
          basePrice: c.defaultPrice,
          priceFrom: minOrNull(open.map((d) => calculatePlanPrice(d.price, plan))),
          availableDays: open.length,
          ratePlans: mapRatePlans(c.farePlans),
        };
      });
      const priceFrom = minOrNull(options.flatMap((o) => (o.priceFrom === null ? [] : [o.priceFrom])));
      return {
        type: 'flight',
        id: key,
        name: first.name,
        airline: first.airline,
        fromAirport: first.fromAirport,
        toAirport: first.toAirport,
        departTime: first.departTime,
        arriveTime: first.arriveTime,
        province: { slug: first.destinationSlug, name: first.destinationName },
        priceFrom,
        isAvailable: priceFrom !== null,
        options,
      };
    });
    return { from: q.from, to: q.to, items, nextCursor: keys.length > q.limit ? pageKeys[pageKeys.length - 1]! : null };
  }

  /**
   * Còn chỗ và giá cho nhiều sản phẩm trong một lần gọi. Mã khách sạn hoặc mã chuyến: trả lựa chọn rẻ nhất còn đặt được.
   * Kết quả giữ đúng thứ tự productIds gửi lên. Giữ chỗ vẫn kiểm lại toàn bộ, nên kết quả này chỉ để hiển thị.
   */
  async checkAvailability(query: CheckAvailabilityQuery): Promise<AvailabilityResult[]> {
    const ids = [...new Set(query.productIds)];
    if (!ids.length || ids.length > MAX_PRODUCT_IDS) throw new CommerceError('invalid_query', `productIds có từ 1 đến ${MAX_PRODUCT_IDS} mã.`, 'productIds');
    if (!isIsoDate(query.checkIn) || query.checkIn < this.today()) throw new CommerceError('invalid_query', 'Ngày nhận phòng / ngày bay phải từ hôm nay trở đi.', 'checkIn');
    if (!Number.isInteger(query.adults) || query.adults < 1 || query.adults > MAX_ADULTS) throw new CommerceError('invalid_query', `Số khách từ 1 đến ${MAX_ADULTS}.`, 'adults');
    if (query.rooms !== undefined && (!Number.isInteger(query.rooms) || query.rooms < 1 || query.rooms > MAX_ROOMS)) {
      throw new CommerceError('invalid_query', `Số phòng từ 1 đến ${MAX_ROOMS}.`, 'rooms');
    }

    const [roomTypesById, roomTypesOfProperties, flightsById, flightsOfKeys] = await Promise.all([
      this.store.catalog.findRoomTypesByIds(ids),
      this.store.catalog.findRoomTypesByPropertyIds(ids),
      this.store.catalog.findFlightsByIds(ids),
      this.store.catalog.findFlightsByKeys(ids),
    ]);
    const roomTypes = [...roomTypesById, ...roomTypesOfProperties];
    const flightCabins = [...flightsById, ...flightsOfKeys];
    if (roomTypes.length && (!isIsoDate(query.checkOut) || query.checkOut <= query.checkIn || countNights(query.checkIn, query.checkOut) > MAX_NIGHTS)) {
      throw new CommerceError('invalid_query', `Ngày trả phòng phải sau ngày nhận phòng, ở tối đa ${MAX_NIGHTS} đêm.`, 'checkOut');
    }
    const [roomDays, flightDays] = await Promise.all([
      roomTypes.length ? this.store.calendar.loadRoomDays(roomTypes.map((r) => r.id), query.checkIn, query.checkOut!) : new Map(),
      flightCabins.length ? this.store.calendar.loadFlightDays(flightCabins.map((f) => f.id), query.checkIn, query.checkIn) : new Map(),
    ]);

    const quoteRoom = (r: RoomTypeRecord) => {
      const rooms = query.rooms ?? countRoomsNeeded(query.adults, r.maxGuests);
      if (rooms * r.maxGuests < query.adults) return { option: r.id, rooms, quote: { isAvailable: false, reason: 'NOT_ENOUGH_ROOMS' } as StayQuote };
      const quote = quoteStay({ days: roomDays.get(r.id) ?? [], checkIn: query.checkIn, checkOut: query.checkOut!, rooms, plan: r.ratePlans[0]! });
      return { option: r.id, rooms, quote };
    };
    const quoteCabin = (f: FlightRecord) => ({
      option: f.id,
      rooms: null,
      quote: quoteFlight({ day: (flightDays.get(f.id) ?? [])[0], passengers: query.adults, plan: f.farePlans[0]! }),
    });

    return query.productIds.map((productId) => {
      const candidates = [
        ...roomTypes.filter((r) => r.id === productId || r.propertyId === productId).map(quoteRoom),
        ...flightCabins.filter((f) => f.id === productId || f.flightKey === productId).map(quoteCabin),
      ];
      if (!candidates.length) return NOT_FOUND(productId);
      const bookable = candidates.flatMap((c) => (c.quote.isAvailable ? [{ ...c, quote: c.quote }] : []));
      if (!bookable.length) {
        const nearest = candidates[0]!.quote;
        return toUnavailable(productId, nearest.isAvailable ? null : nearest.reason, nearest.isAvailable ? null : (nearest.remaining ?? null));
      }
      const best = bookable.reduce((a, b) => (b.quote.totalPrice < a.quote.totalPrice ? b : a));
      return {
        productId,
        isFound: true,
        isAvailable: true,
        optionId: best.option,
        reason: null,
        roomsNeeded: best.rooms,
        remaining: best.quote.remaining,
        totalPrice: best.quote.totalPrice,
        unitPrice: best.quote.pricePerNight,
        ratePlanCode: best.quote.plan.code,
      };
    });
  }
}
