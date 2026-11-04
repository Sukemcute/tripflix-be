import type { Db } from '@tripflix/db';
import { and, asc, eq, gt, gte, inArray, lte, max } from 'drizzle-orm';
import { flightInventory, flights, properties, roomInventory, roomRates, roomTypes, type FlightRow, type PropertyRow, type RoomTypeRow } from '../../db/schema/index.js';
import type {
  CalendarRepository,
  CatalogRepository,
  CommerceStore,
  FlightRecord,
  NewFlightDay,
  NewRoomDay,
  PropertyRecord,
  RoomTypeRecord,
} from '../application/ports.js';
import type { FlightDay, RoomDay } from '../domain/sales-rules.js';

const mapProperty = (row: PropertyRow): PropertyRecord => ({
  id: row.id,
  name: row.name,
  provinceSlug: row.provinceSlug,
  provinceName: row.provinceName,
  city: row.city,
  stars: row.stars,
  brand: row.brand,
  style: row.style,
  thumbnail: row.thumbnail,
  images: row.images,
});

const mapRoomType = (row: RoomTypeRow): RoomTypeRecord => ({
  id: row.id,
  propertyId: row.propertyId,
  name: row.name,
  maxGuests: row.maxGuests,
  defaultTotal: row.defaultTotal,
  defaultPrice: row.defaultPrice,
  ratePlans: row.ratePlans,
});

const mapFlight = (row: FlightRow): FlightRecord => ({
  id: row.id,
  flightKey: row.flightKey,
  name: row.name,
  airline: row.airline,
  fromAirport: row.fromAirport,
  toAirport: row.toAirport,
  departTime: row.departTime,
  arriveTime: row.arriveTime,
  destinationSlug: row.destinationSlug,
  destinationName: row.destinationName,
  cabinName: row.cabinName,
  defaultSeats: row.defaultSeats,
  defaultPrice: row.defaultPrice,
  farePlans: row.farePlans,
});

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Db) {}

  async listProperties(filter: { provinceSlug?: string; afterId?: string; limit: number }) {
    const rows = await this.db
      .select()
      .from(properties)
      .where(and(filter.provinceSlug ? eq(properties.provinceSlug, filter.provinceSlug) : undefined, filter.afterId ? gt(properties.id, filter.afterId) : undefined))
      .orderBy(asc(properties.id))
      .limit(filter.limit);
    return rows.map(mapProperty);
  }

  async findRoomTypesByPropertyIds(propertyIds: string[]) {
    if (!propertyIds.length) return [];
    const rows = await this.db.select().from(roomTypes).where(inArray(roomTypes.propertyId, propertyIds)).orderBy(asc(roomTypes.defaultPrice), asc(roomTypes.id));
    return rows.map(mapRoomType);
  }

  async findRoomTypesByIds(ids: string[]) {
    if (!ids.length) return [];
    return (await this.db.select().from(roomTypes).where(inArray(roomTypes.id, ids))).map(mapRoomType);
  }

  async listFlights(filter: { destinationSlug?: string; afterKey?: string; limit: number }) {
    const keys = await this.db
      .selectDistinct({ flightKey: flights.flightKey })
      .from(flights)
      .where(and(filter.destinationSlug ? eq(flights.destinationSlug, filter.destinationSlug) : undefined, filter.afterKey ? gt(flights.flightKey, filter.afterKey) : undefined))
      .orderBy(asc(flights.flightKey))
      .limit(filter.limit);
    return this.findFlightsByKeys(keys.map((k) => k.flightKey));
  }

  async findFlightsByIds(ids: string[]) {
    if (!ids.length) return [];
    return (await this.db.select().from(flights).where(inArray(flights.id, ids))).map(mapFlight);
  }

  async findFlightsByKeys(flightKeys: string[]) {
    if (!flightKeys.length) return [];
    const rows = await this.db.select().from(flights).where(inArray(flights.flightKey, flightKeys)).orderBy(asc(flights.flightKey), asc(flights.defaultPrice));
    return rows.map(mapFlight);
  }
}

class DrizzleCalendarRepository implements CalendarRepository {
  constructor(private readonly db: Db) {}

  async loadRoomDays(roomTypeIds: string[], from: string, toInclusive: string) {
    if (!roomTypeIds.length) return new Map<string, RoomDay[]>();
    const rows = await this.db
      .select({
        roomTypeId: roomInventory.roomTypeId,
        date: roomInventory.date,
        total: roomInventory.total,
        held: roomInventory.held,
        sold: roomInventory.sold,
        price: roomRates.price,
        isStopSell: roomInventory.stopSell,
        isClosedToArrival: roomInventory.cta,
        isClosedToDeparture: roomInventory.ctd,
        minLos: roomInventory.minLos,
        maxLos: roomInventory.maxLos,
      })
      .from(roomInventory)
      .innerJoin(roomRates, and(eq(roomRates.roomTypeId, roomInventory.roomTypeId), eq(roomRates.date, roomInventory.date)))
      .where(and(inArray(roomInventory.roomTypeId, roomTypeIds), gte(roomInventory.date, from), lte(roomInventory.date, toInclusive)))
      .orderBy(asc(roomInventory.date));
    const grouped = groupBy(rows, (r) => r.roomTypeId);
    return new Map([...grouped].map(([id, list]) => [id, list.map(({ roomTypeId: _id, ...day }) => day)]));
  }

  async loadFlightDays(flightIds: string[], from: string, toInclusive: string) {
    if (!flightIds.length) return new Map<string, FlightDay[]>();
    const rows = await this.db
      .select({
        flightId: flightInventory.flightId,
        date: flightInventory.date,
        total: flightInventory.total,
        held: flightInventory.held,
        sold: flightInventory.sold,
        price: flightInventory.price,
        isStopSell: flightInventory.stopSell,
      })
      .from(flightInventory)
      .where(and(inArray(flightInventory.flightId, flightIds), gte(flightInventory.date, from), lte(flightInventory.date, toInclusive)))
      .orderBy(asc(flightInventory.date));
    const grouped = groupBy(rows, (r) => r.flightId);
    return new Map([...grouped].map(([id, list]) => [id, list.map(({ flightId: _id, ...day }) => day)]));
  }

  async findLastOpenedRoomDates() {
    const rows = await this.db.select({ id: roomInventory.roomTypeId, last: max(roomInventory.date) }).from(roomInventory).groupBy(roomInventory.roomTypeId);
    return new Map(rows.flatMap((r) => (r.last ? [[r.id, r.last] as const] : [])));
  }

  async findLastOpenedFlightDates() {
    const rows = await this.db.select({ id: flightInventory.flightId, last: max(flightInventory.date) }).from(flightInventory).groupBy(flightInventory.flightId);
    return new Map(rows.flatMap((r) => (r.last ? [[r.id, r.last] as const] : [])));
  }

  // Lịch phòng và giá mở cùng một transaction: không có ngày có phòng mà thiếu giá.
  async insertRoomDays(days: NewRoomDay[]) {
    if (!days.length) return 0;
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(roomInventory)
        .values(
          days.map((d) => ({
            roomTypeId: d.roomTypeId,
            date: d.date,
            total: d.total,
            stopSell: d.isStopSell,
            cta: d.isClosedToArrival,
            ctd: d.isClosedToDeparture,
            minLos: d.minLos,
            maxLos: d.maxLos,
          })),
        )
        .onConflictDoNothing()
        .returning({ roomTypeId: roomInventory.roomTypeId });
      await tx
        .insert(roomRates)
        .values(days.map((d) => ({ roomTypeId: d.roomTypeId, date: d.date, price: d.price })))
        .onConflictDoNothing();
      return inserted.length;
    });
  }

  async insertFlightDays(days: NewFlightDay[]) {
    if (!days.length) return 0;
    const inserted = await this.db
      .insert(flightInventory)
      .values(days.map((d) => ({ flightId: d.flightId, date: d.date, total: d.total, price: d.price, stopSell: d.isStopSell })))
      .onConflictDoNothing()
      .returning({ flightId: flightInventory.flightId });
    return inserted.length;
  }

  async listAllRoomTypes() {
    const rows = await this.db.select({ roomType: roomTypes, stars: properties.stars }).from(roomTypes).innerJoin(properties, eq(properties.id, roomTypes.propertyId));
    return rows.map((r) => ({ ...mapRoomType(r.roomType), stars: r.stars }));
  }

  async listAllFlights() {
    return (await this.db.select().from(flights)).map(mapFlight);
  }
}

export class DrizzleCommerceStore implements CommerceStore {
  readonly catalog: CatalogRepository;
  readonly calendar: CalendarRepository;

  constructor(db: Db) {
    this.catalog = new DrizzleCatalogRepository(db);
    this.calendar = new DrizzleCalendarRepository(db);
  }
}
