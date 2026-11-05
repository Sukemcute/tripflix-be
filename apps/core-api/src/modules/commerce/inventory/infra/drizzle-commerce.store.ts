import { Injectable } from '@nestjs/common';
import { InjectTransactionHost, type Db } from '@tripflix/db';
import { and, asc, eq, gt, gte, inArray, lte, max, sql } from 'drizzle-orm';
import { auditLogs, flightInventory, flights, properties, roomInventory, roomRates, roomTypes, type FlightRow, type PropertyRow, type RoomTypeRow } from '../../db/schema/index.js';
import type {
  CalendarAdminRepository,
  CalendarRepository,
  CatalogRepository,
  CommerceStore,
  FlightCalendarPatch,
  FlightRecord,
  NewFlightDay,
  NewRoomDay,
  PropertyRecord,
  RoomCalendarPatch,
  RoomTypeRecord,
} from '../application/ports.js';

/** Nguồn kết nối: TransactionHost của commerce (có .tx) hoặc { tx: db } khi chạy ngoài Nest. */
export interface DbHost {
  readonly tx: Db;
}
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
  constructor(private readonly host: DbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

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
  constructor(private readonly host: DbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

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

  // Lịch phòng và giá chèn trong một câu lệnh (CTE): không có ngày có phòng mà thiếu giá, không cần mở transaction ở infra.
  async insertRoomDays(days: NewRoomDay[]) {
    if (!days.length) return 0;
    const rows = JSON.stringify(
      days.map((d) => ({
        room_type_id: d.roomTypeId,
        date: d.date,
        total: d.total,
        price: d.price,
        stop_sell: d.isStopSell,
        cta: d.isClosedToArrival,
        ctd: d.isClosedToDeparture,
        min_los: d.minLos,
        max_los: d.maxLos,
      })),
    );
    const result = await this.db.execute<{ inserted: number }>(sql`
      with input as (
        select * from jsonb_to_recordset(${rows}::jsonb) as x(room_type_id text, date date, total int, price bigint, stop_sell boolean, cta boolean, ctd boolean, min_los smallint, max_los smallint)
      ),
      inserted as (
        insert into commerce.room_inventory (room_type_id, date, total, stop_sell, cta, ctd, min_los, max_los)
        select room_type_id, date, total, stop_sell, cta, ctd, min_los, max_los from input
        on conflict do nothing
        returning room_type_id, date
      ),
      rates as (
        insert into commerce.room_rates (room_type_id, date, price)
        select room_type_id, date, price from input
        on conflict do nothing
      )
      select count(*)::int as inserted from inserted`);
    return result.rows[0]?.inserted ?? 0;
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

class DrizzleCalendarAdminRepository implements CalendarAdminRepository {
  constructor(private readonly host: DbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

  async countRoomDays(roomTypeId: string, from: string, toInclusive: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(roomInventory)
      .where(and(eq(roomInventory.roomTypeId, roomTypeId), gte(roomInventory.date, from), lte(roomInventory.date, toInclusive)));
    return row?.count ?? 0;
  }

  async countFlightDays(flightId: string, from: string, toInclusive: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(flightInventory)
      .where(and(eq(flightInventory.flightId, flightId), gte(flightInventory.date, from), lte(flightInventory.date, toInclusive)));
    return row?.count ?? 0;
  }

  async updateRoomDays(roomTypeId: string, from: string, toInclusive: string, patch: RoomCalendarPatch) {
    const range = and(eq(roomInventory.roomTypeId, roomTypeId), gte(roomInventory.date, from), lte(roomInventory.date, toInclusive));
    const set = {
      ...(patch.total !== undefined && { total: patch.total }),
      ...(patch.isStopSell !== undefined && { stopSell: patch.isStopSell }),
      ...(patch.isClosedToArrival !== undefined && { cta: patch.isClosedToArrival }),
      ...(patch.isClosedToDeparture !== undefined && { ctd: patch.isClosedToDeparture }),
      ...(patch.minLos !== undefined && { minLos: patch.minLos }),
      ...(patch.maxLos !== undefined && { maxLos: patch.maxLos }),
    };
    let updated = await this.countRoomDays(roomTypeId, from, toInclusive);
    if (Object.keys(set).length) {
      // Điều kiện nằm trong UPDATE: hai admin sửa cùng lúc, hay có người vừa giữ chỗ, vẫn không giảm được dưới held + sold.
      const where = patch.total !== undefined ? and(range, sql`${roomInventory.held} + ${roomInventory.sold} <= ${patch.total}`) : range;
      updated = (await this.db.update(roomInventory).set(set).where(where).returning({ date: roomInventory.date })).length;
    }
    if (patch.price !== undefined) {
      await this.db
        .update(roomRates)
        .set({ price: patch.price })
        .where(and(eq(roomRates.roomTypeId, roomTypeId), gte(roomRates.date, from), lte(roomRates.date, toInclusive)));
    }
    return updated;
  }

  async updateFlightDays(flightId: string, from: string, toInclusive: string, patch: FlightCalendarPatch) {
    const range = and(eq(flightInventory.flightId, flightId), gte(flightInventory.date, from), lte(flightInventory.date, toInclusive));
    const set = {
      ...(patch.total !== undefined && { total: patch.total }),
      ...(patch.price !== undefined && { price: patch.price }),
      ...(patch.isStopSell !== undefined && { stopSell: patch.isStopSell }),
    };
    if (!Object.keys(set).length) return this.countFlightDays(flightId, from, toInclusive);
    const where = patch.total !== undefined ? and(range, sql`${flightInventory.held} + ${flightInventory.sold} <= ${patch.total}`) : range;
    return (await this.db.update(flightInventory).set(set).where(where).returning({ date: flightInventory.date })).length;
  }

  async findOverbookedRoomDates(roomTypeId: string, from: string, toInclusive: string, total: number) {
    const rows = await this.db
      .select({ date: roomInventory.date })
      .from(roomInventory)
      .where(and(eq(roomInventory.roomTypeId, roomTypeId), gte(roomInventory.date, from), lte(roomInventory.date, toInclusive), sql`${roomInventory.held} + ${roomInventory.sold} > ${total}`))
      .orderBy(asc(roomInventory.date));
    return rows.map((r) => r.date);
  }

  async findOverbookedFlightDates(flightId: string, from: string, toInclusive: string, total: number) {
    const rows = await this.db
      .select({ date: flightInventory.date })
      .from(flightInventory)
      .where(and(eq(flightInventory.flightId, flightId), gte(flightInventory.date, from), lte(flightInventory.date, toInclusive), sql`${flightInventory.held} + ${flightInventory.sold} > ${total}`))
      .orderBy(asc(flightInventory.date));
    return rows.map((r) => r.date);
  }

  async insertAuditLog(entry: { actorUserId: string; action: string; entityType: 'room_type' | 'flight'; entityId: string; changes: Record<string, unknown> }) {
    await this.db.insert(auditLogs).values(entry);
  }
}

@Injectable()
export class DrizzleCommerceStore implements CommerceStore {
  readonly catalog: CatalogRepository;
  readonly calendar: CalendarRepository;

  readonly admin: CalendarAdminRepository;

  /** host.tx là transaction đang mở của commerce (@Transactional), hoặc kết nối thường; script CLI truyền { tx: db }. */
  constructor(@InjectTransactionHost('commerce') host: DbHost) {
    this.catalog = new DrizzleCatalogRepository(host);
    this.calendar = new DrizzleCalendarRepository(host);
    this.admin = new DrizzleCalendarAdminRepository(host);
  }
}
