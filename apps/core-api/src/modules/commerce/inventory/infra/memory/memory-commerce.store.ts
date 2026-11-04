import type {
  CalendarRepository,
  CatalogRepository,
  CommerceStore,
  FlightRecord,
  NewFlightDay,
  NewRoomDay,
  PropertyRecord,
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
