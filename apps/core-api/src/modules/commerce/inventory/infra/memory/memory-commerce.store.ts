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
} from '../../application/ports.js';
import type { FlightDay, RoomDay } from '../../domain/sales-rules.js';

/** Bản trong bộ nhớ của CommerceStore cho unit test; cùng hành vi với bản Drizzle ở những gì use case dùng. */
export class MemoryCommerceStore implements CommerceStore {
  readonly properties: PropertyRecord[] = [];
  readonly roomTypes: RoomTypeRecord[] = [];
  readonly flights: FlightRecord[] = [];
  readonly roomDays = new Map<string, RoomDay>();
  readonly flightDays = new Map<string, FlightDay>();

  readonly catalog: CatalogRepository = {
    listProperties: async ({ provinceSlug, afterId, limit }) =>
      this.properties
        .filter((p) => (!provinceSlug || p.provinceSlug === provinceSlug) && (!afterId || p.id > afterId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    findRoomTypesByPropertyIds: async (ids) => this.roomTypes.filter((r) => ids.includes(r.propertyId)).sort((a, b) => a.defaultPrice - b.defaultPrice),
    findRoomTypesByIds: async (ids) => this.roomTypes.filter((r) => ids.includes(r.id)),
    listFlights: async ({ destinationSlug, afterKey, limit }) => {
      const keys = [...new Set(this.flights.filter((f) => (!destinationSlug || f.destinationSlug === destinationSlug) && (!afterKey || f.flightKey > afterKey)).map((f) => f.flightKey))]
        .sort()
        .slice(0, limit);
      return this.catalog.findFlightsByKeys(keys);
    },
    findFlightsByIds: async (ids) => this.flights.filter((f) => ids.includes(f.id)),
    findFlightsByKeys: async (keys) => this.flights.filter((f) => keys.includes(f.flightKey)).sort((a, b) => a.flightKey.localeCompare(b.flightKey) || a.defaultPrice - b.defaultPrice),
  };

  readonly calendar: CalendarRepository = {
    loadRoomDays: async (ids, from, to) => this.loadDays(this.roomDays, ids, from, to),
    loadFlightDays: async (ids, from, to) => this.loadDays(this.flightDays, ids, from, to),
    findLastOpenedRoomDates: async () => this.findLastDates(this.roomDays),
    findLastOpenedFlightDates: async () => this.findLastDates(this.flightDays),
    insertRoomDays: async (days: NewRoomDay[]) => this.insertDays(this.roomDays, days.map(({ roomTypeId, ...d }) => [roomTypeId, { ...d, held: 0, sold: 0 }] as const)),
    insertFlightDays: async (days: NewFlightDay[]) => this.insertDays(this.flightDays, days.map(({ flightId, ...d }) => [flightId, { ...d, held: 0, sold: 0 }] as const)),
    listAllRoomTypes: async () => this.roomTypes.map((r) => ({ ...r, stars: this.properties.find((p) => p.id === r.propertyId)?.stars ?? null })),
    listAllFlights: async () => [...this.flights],
  };

  readonly auditLogs: { actorUserId: string; action: string; entityType: string; entityId: string; changes: Record<string, unknown> }[] = [];

  // Bản Postgres là một câu UPDATE có điều kiện; ở đây kiểm hết rồi mới ghi để giống "hoặc tất cả, hoặc không ngày nào".
  readonly admin: CalendarAdminRepository = {
    countRoomDays: async (id, from, to) => (this.loadDays(this.roomDays, [id], from, to).get(id) ?? []).length,
    countFlightDays: async (id, from, to) => (this.loadDays(this.flightDays, [id], from, to).get(id) ?? []).length,
    updateRoomDays: async (id, from, to, patch: RoomCalendarPatch) => {
      const days = this.loadDays(this.roomDays, [id], from, to).get(id) ?? [];
      const allowed = days.filter((d) => patch.total === undefined || d.held + d.sold <= patch.total);
      for (const d of allowed) {
        this.patchRoomDay(id, d.date, {
          ...(patch.total !== undefined && { total: patch.total }),
          ...(patch.price !== undefined && { price: patch.price }),
          ...(patch.isStopSell !== undefined && { isStopSell: patch.isStopSell }),
          ...(patch.isClosedToArrival !== undefined && { isClosedToArrival: patch.isClosedToArrival }),
          ...(patch.isClosedToDeparture !== undefined && { isClosedToDeparture: patch.isClosedToDeparture }),
          ...(patch.minLos !== undefined && { minLos: patch.minLos }),
          ...(patch.maxLos !== undefined && { maxLos: patch.maxLos }),
        });
      }
      return allowed.length;
    },
    updateFlightDays: async (id, from, to, patch: FlightCalendarPatch) => {
      const days = this.loadDays(this.flightDays, [id], from, to).get(id) ?? [];
      const allowed = days.filter((d) => patch.total === undefined || d.held + d.sold <= patch.total);
      for (const d of allowed) this.flightDays.set(`${id}|${d.date}`, { ...d, ...patch });
      return allowed.length;
    },
    findOverbookedRoomDates: async (id, from, to, total) =>
      (this.loadDays(this.roomDays, [id], from, to).get(id) ?? []).filter((d) => d.held + d.sold > total).map((d) => d.date),
    findOverbookedFlightDates: async (id, from, to, total) =>
      (this.loadDays(this.flightDays, [id], from, to).get(id) ?? []).filter((d) => d.held + d.sold > total).map((d) => d.date),
    insertAuditLog: async (entry) => {
      this.auditLogs.push(entry);
    },
  };

  /** Sửa một ngày đã mở (test giả lập đã bán, ngừng bán…). */
  patchRoomDay(roomTypeId: string, date: string, patch: Partial<RoomDay>) {
    const key = `${roomTypeId}|${date}`;
    this.roomDays.set(key, { ...this.roomDays.get(key)!, ...patch });
  }

  private loadDays<T extends { date: string }>(store: Map<string, T>, ids: string[], from: string, to: string): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const [key, day] of [...store].sort((a, b) => a[1].date.localeCompare(b[1].date))) {
      const id = key.split('|')[0]!;
      if (ids.includes(id) && day.date >= from && day.date <= to) out.set(id, [...(out.get(id) ?? []), day]);
    }
    return out;
  }

  private findLastDates(store: Map<string, { date: string }>): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, day] of store) {
      const id = key.split('|')[0]!;
      if (!out.has(id) || day.date > out.get(id)!) out.set(id, day.date);
    }
    return out;
  }

  private insertDays<T extends { date: string }>(store: Map<string, T>, rows: (readonly [string, T])[]): number {
    let inserted = 0;
    for (const [id, day] of rows) {
      const key = `${id}|${day.date}`;
      if (store.has(key)) continue;
      store.set(key, day);
      inserted++;
    }
    return inserted;
  }
}
