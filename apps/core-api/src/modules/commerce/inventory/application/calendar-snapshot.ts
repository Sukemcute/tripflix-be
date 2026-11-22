import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ReadCalendar } from './ports.js';
import type { FlightDay, RoomDay } from '../domain/sales-rules.js';

/** Nguồn nạp cả lịch một lần (DrizzleCalendarRepository). Store trong bộ nhớ của test không có, khi đó snapshot không bật. */
export interface CalendarBulkSource {
  loadAllRoomDays(from: string): Promise<Map<string, RoomDay[]>>;
  loadAllFlightDays(from: string): Promise<Map<string, FlightDay[]>>;
}

/** Nguồn nạp được phần thay đổi theo cột changed_at (L1). Không có thì snapshot nạp cả lịch mỗi lượt như trước. */
export interface CalendarDeltaSource {
  databaseNow(): Promise<string>;
  loadChangedRoomDays(from: string, since: string): Promise<Map<string, RoomDay[]>>;
  loadChangedFlightDays(from: string, since: string): Promise<Map<string, FlightDay[]>>;
}

const hasDeltaLoad = (source: unknown): source is CalendarDeltaSource =>
  typeof (source as Partial<CalendarDeltaSource>).databaseNow === 'function' &&
  typeof (source as Partial<CalendarDeltaSource>).loadChangedRoomDays === 'function' &&
  typeof (source as Partial<CalendarDeltaSource>).loadChangedFlightDays === 'function';

export const hasBulkLoad = (calendar: unknown): calendar is CalendarBulkSource =>
  typeof (calendar as Partial<CalendarBulkSource>).loadAllRoomDays === 'function' && typeof (calendar as Partial<CalendarBulkSource>).loadAllFlightDays === 'function';

interface Loaded {
  from: string;
  rooms: Map<string, RoomDay[]>;
  flights: Map<string, FlightDay[]>;
  /** Giờ database ngay trước lượt nạp gần nhất; lượt sau đọc các dòng đổi sau (mốc này - overlapMs). */
  cursor: string | null;
  /** Lúc nạp cả lịch gần nhất (đồng hồ tiến trình), để định kỳ nạp lại toàn bộ cho chắc. */
  fullAt: number;
}

/** Ngày đầu tiên có trong danh sách đã sắp theo ngày mà >= date. */
function findFirstIndex(days: { date: string }[], date: string): number {
  let low = 0;
  let high = days.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (days[mid]!.date < date) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Ghi đè hoặc chèn các ngày vừa đổi vào danh sách đã sắp theo ngày. Chạy đồng bộ nên người đọc không thấy bản dở dang. */
function mergeDays<T extends { date: string }>(target: Map<string, T[]>, changed: Map<string, T[]>): void {
  for (const [id, days] of changed) {
    const list = target.get(id);
    if (!list) {
      target.set(id, days);
      continue;
    }
    for (const day of days) {
      const i = findFirstIndex(list, day.date);
      if (list[i]?.date === day.date) list[i] = day;
      else list.splice(i, 0, day);
    }
  }
}

function pickDays<T extends { date: string }>(source: Map<string, T[]>, ids: string[], from: string, toInclusive: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const id of new Set(ids)) {
    const days = source.get(id);
    if (!days) continue;
    const picked: T[] = [];
    for (let i = findFirstIndex(days, from); i < days.length && days[i]!.date <= toInclusive; i++) picked.push(days[i]!);
    // Giống truy vấn DB: loại phòng không có ngày nào trong khoảng thì không có trong Map.
    if (picked.length) out.set(id, picked);
  }
  return out;
}

/**
 * Lịch trống và giá trong bộ nhớ cho các trang chỉ đọc (tìm khách sạn, chi tiết khách sạn).
 * Mỗi `refreshMs` chỉ nạp các ô có changed_at mới hơn lượt trước (đọc chồng `overlapMs` để không sót transaction
 * commit muộn); cứ `fullReloadMs` thì nạp lại cả lịch. Trước L1, lượt nào cũng nạp cả lịch: dữ liệu x10 mất ~8 giây
 * và Postgres tốn gần 4 nhân dù không có khách.
 * Giữ chỗ và thanh toán không dùng lớp này: chúng khoá và kiểm tồn kho thật trong transaction, nên số hiển thị cũ
 * vài giây không làm bán quá. Chưa nạp xong, hoặc hỏi ngày trước mốc đã nạp, thì đọc thẳng database.
 * Nạp lỗi thì giữ bản cũ (trang tìm vẫn chạy khi database chập chờn) và thử lại ở lượt sau.
 */
export class CalendarSnapshot implements ReadCalendar, OnModuleInit, OnModuleDestroy {
  private loaded: Loaded | null = null;
  private refreshing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: {
      fallback: ReadCalendar;
      source: CalendarBulkSource;
      today: () => string;
      refreshMs: number;
      /** Mặc định 15 phút. */
      fullReloadMs?: number;
      /** Mặc định 60 giây: transaction ghi lịch kéo dài hơn mức này mà commit muộn thì đợi lượt nạp cả lịch. */
      overlapMs?: number;
      now?: () => number;
      onError?: (error: unknown) => void;
    },
  ) {}

  /** Nạp lần đầu (không chờ) rồi nạp lại theo chu kỳ. Timer unref để không giữ tiến trình sống. */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  get isLoaded(): boolean {
    return this.loaded !== null;
  }

  /** Nạp lại (phần đổi hoặc cả lịch); lượt trước chưa xong thì dùng chung, không chạy chồng. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load(): Promise<void> {
    const from = this.options.today();
    const source = this.options.source;
    const now = this.options.now ?? Date.now;
    const loaded = this.loaded;
    try {
      const canDelta = hasDeltaLoad(source) && loaded?.cursor != null && now() - loaded.fullAt < (this.options.fullReloadMs ?? 15 * 60_000);
      // Mốc lấy trước khi đọc: dòng ghi trong lúc đang đọc sẽ được lượt sau đọc lại.
      const cursor = hasDeltaLoad(source) ? await source.databaseNow() : null;
      if (canDelta && loaded && cursor) {
        const since = new Date(Date.parse(loaded.cursor!) - (this.options.overlapMs ?? 60_000)).toISOString();
        const [rooms, flights] = await Promise.all([source.loadChangedRoomDays(loaded.from, since), source.loadChangedFlightDays(loaded.from, since)]);
        mergeDays(loaded.rooms, rooms);
        mergeDays(loaded.flights, flights);
        loaded.cursor = cursor;
        return;
      }
      const [rooms, flights] = await Promise.all([source.loadAllRoomDays(from), source.loadAllFlightDays(from)]);
      this.loaded = { from, rooms, flights, cursor, fullAt: now() };
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  loadRoomDays(roomTypeIds: string[], from: string, toInclusive: string): Promise<Map<string, RoomDay[]>> {
    const loaded = this.loaded;
    if (!loaded || from < loaded.from) return this.options.fallback.loadRoomDays(roomTypeIds, from, toInclusive);
    return Promise.resolve(pickDays(loaded.rooms, roomTypeIds, from, toInclusive));
  }

  loadFlightDays(flightIds: string[], from: string, toInclusive: string): Promise<Map<string, FlightDay[]>> {
    const loaded = this.loaded;
    if (!loaded || from < loaded.from) return this.options.fallback.loadFlightDays(flightIds, from, toInclusive);
    return Promise.resolve(pickDays(loaded.flights, flightIds, from, toInclusive));
  }
}
