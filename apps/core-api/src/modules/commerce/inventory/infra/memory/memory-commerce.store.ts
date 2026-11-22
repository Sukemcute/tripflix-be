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
  ReviewRecord,
  ReviewRepository,
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
  /** Đánh giá; status khác published thì không trả ra (giống bản Postgres). */
  readonly reviewRows: (ReviewRecord & { status?: string })[] = [];

  readonly reviews: ReviewRepository = {
    listReviews: async ({ propertyId, rating, tag, travelerType, sort, offset, limit }) => {
      const byNewest = (a: ReviewRecord, b: ReviewRecord) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
      const compare = {
        newest: byNewest,
        highest: (a: ReviewRecord, b: ReviewRecord) => b.rating - a.rating || byNewest(a, b),
        lowest: (a: ReviewRecord, b: ReviewRecord) => a.rating - b.rating || byNewest(a, b),
        helpful: (a: ReviewRecord, b: ReviewRecord) => b.helpfulCount - a.helpfulCount || byNewest(a, b),
      }[sort];
      const matched = this.publishedReviews(propertyId)
        .filter((r) => (rating === undefined || r.rating === rating) && (!travelerType || r.travelerType === travelerType) && (!tag || r.tags.includes(tag)))
        .sort(compare);
      return { items: matched.slice(offset, offset + limit), total: matched.length };
    },
    getReviewStats: async (propertyId, tagLimit) => {
      const rows = this.publishedReviews(propertyId);
      const tagCounts = new Map<string, number>();
      for (const tag of rows.flatMap((r) => r.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      return {
        count: rows.length,
        average: rows.length ? rows.reduce((sum, r) => sum + r.rating, 0) / rows.length : null,
        distribution: [1, 2, 3, 4, 5].map((star) => rows.filter((r) => r.rating === star).length),
        tags: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, tagLimit),
      };
    },
  };

  readonly catalog: CatalogRepository = {
    listProperties: async ({ provinceSlug, afterId, limit }) =>
      this.properties
        .filter((p) => (!provinceSlug || p.provinceSlug === provinceSlug) && (!afterId || p.id > afterId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    findPropertyById: async (id) => this.properties.find((p) => p.id === id) ?? null,
    findPropertyBySlugOrId: async (slugOrId) => this.properties.find((p) => p.slug === slugOrId || p.id === slugOrId) ?? null,
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
    findFlightsByRoute: async (fromAirport, toAirport) =>
      this.flights
        .filter((f) => f.fromAirport === fromAirport && f.toAirport === toAirport)
        .sort((a, b) => (a.departTime ?? '').localeCompare(b.departTime ?? '') || a.flightKey.localeCompare(b.flightKey) || a.defaultPrice - b.defaultPrice),
    listFlightRoutes: async () => {
      const routes = new Map<string, { fromAirport: string; toAirport: string; destinationSlug: string; destinationName: string; keys: Set<string> }>();
      for (const f of this.flights) {
        const id = `${f.fromAirport}|${f.toAirport}|${f.destinationSlug}`;
        const route = routes.get(id) ?? { fromAirport: f.fromAirport, toAirport: f.toAirport, destinationSlug: f.destinationSlug, destinationName: f.destinationName, keys: new Set<string>() };
        route.keys.add(f.flightKey);
        routes.set(id, route);
      }
      return [...routes.values()]
        .map(({ keys, ...route }) => ({ ...route, flightCount: keys.size }))
        .sort((a, b) => a.fromAirport.localeCompare(b.fromAirport) || a.toAirport.localeCompare(b.toAirport));
    },
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

  private publishedReviews(propertyId: string) {
    return this.reviewRows.filter((r) => r.propertyId === propertyId && (r.status ?? 'published') === 'published');
  }

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
