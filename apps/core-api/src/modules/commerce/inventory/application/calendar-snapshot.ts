import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ReadCalendar } from './ports.js';
import type { FlightDay, RoomDay } from '../domain/sales-rules.js';

/** Nguồn nạp cả lịch một lần (DrizzleCalendarRepository). Store trong bộ nhớ của test không có, khi đó snapshot không bật. */
export interface CalendarBulkSource {
  loadAllRoomDays(from: string): Promise<Map<string, RoomDay[]>>;
  loadAllFlightDays(from: string): Promise<Map<string, FlightDay[]>>;
}

export const hasBulkLoad = (calendar: unknown): calendar is CalendarBulkSource =>
  typeof (calendar as Partial<CalendarBulkSource>).loadAllRoomDays === 'function' && typeof (calendar as Partial<CalendarBulkSource>).loadAllFlightDays === 'function';

interface Loaded {
  from: string;
  rooms: Map<string, RoomDay[]>;
  flights: Map<string, FlightDay[]>;
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
 * Lịch trống và giá trong bộ nhớ cho các trang chỉ đọc (tìm khách sạn, chi tiết khách sạn), nạp lại cả lịch mỗi vài giây.
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

  /** Nạp lại cả lịch từ hôm nay; lượt trước chưa xong thì dùng chung, không chạy chồng. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load(): Promise<void> {
    const from = this.options.today();
    try {
      const [rooms, flights] = await Promise.all([this.options.source.loadAllRoomDays(from), this.options.source.loadAllFlightDays(from)]);
      this.loaded = { from, rooms, flights };
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
