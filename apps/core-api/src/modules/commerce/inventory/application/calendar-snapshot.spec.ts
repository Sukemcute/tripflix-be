import { CalendarSnapshot, hasBulkLoad, type CalendarBulkSource } from './calendar-snapshot.js';
import type { ReadCalendar } from './ports.js';
import type { FlightDay, RoomDay } from '../domain/sales-rules.js';

const room = (date: string, held = 0): RoomDay => ({ date, total: 5, held, sold: 0, price: 1_000_000, isStopSell: false, isClosedToArrival: false, isClosedToDeparture: false, minLos: 1, maxLos: 30 }) as RoomDay;
const flight = (date: string): FlightDay => ({ date, total: 50, held: 0, sold: 0, price: 900_000, isStopSell: false }) as FlightDay;

function setup(rooms: Map<string, RoomDay[]>, flights = new Map<string, FlightDay[]>()) {
  const calls = { bulk: 0, fallback: 0 };
  let failNext = false;
  const source: CalendarBulkSource = {
    loadAllRoomDays: async () => {
      calls.bulk += 1;
      if (failNext) throw new Error('db');
      return rooms;
    },
    loadAllFlightDays: async () => flights,
  };
  const fallback: ReadCalendar = {
    loadRoomDays: async () => {
      calls.fallback += 1;
      return new Map([['DB', [room('2026-12-01')]]]);
    },
    loadFlightDays: async () => {
      calls.fallback += 1;
      return new Map();
    },
  };
  const snapshot = new CalendarSnapshot({ fallback, source, today: () => '2026-12-01', refreshMs: 60_000 });
  return { snapshot, calls, failOnce: () => (failNext = true) };
}

describe('CalendarSnapshot', () => {
  it('chưa nạp xong thì đọc thẳng database', async () => {
    const { snapshot, calls } = setup(new Map());
    expect([...(await snapshot.loadRoomDays(['A'], '2026-12-01', '2026-12-02')).keys()]).toEqual(['DB']);
    expect(calls.fallback).toBe(1);
  });

  it('nạp xong thì trả đúng khoảng ngày từ bộ nhớ, không gọi database', async () => {
    const days = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'].map((d) => room(d));
    const { snapshot, calls } = setup(new Map([['A', days], ['B', [room('2026-12-09')]]]));
    await snapshot.refresh();
    const got = await snapshot.loadRoomDays(['A', 'B', 'C', 'A'], '2026-12-02', '2026-12-03');
    expect(got.get('A')!.map((d) => d.date)).toEqual(['2026-12-02', '2026-12-03']);
    // Giống truy vấn DB: không có ngày nào trong khoảng, hoặc không có loại phòng, thì không có trong kết quả.
    expect(got.has('B')).toBe(false);
    expect(got.has('C')).toBe(false);
    expect(calls.fallback).toBe(0);
  });

  it('chuyến bay cũng đọc từ bộ nhớ', async () => {
    const { snapshot } = setup(new Map(), new Map([['F1', [flight('2026-12-05'), flight('2026-12-06')]]]));
    await snapshot.refresh();
    const got = await snapshot.loadFlightDays(['F1'], '2026-12-06', '2026-12-06');
    expect(got.get('F1')!.map((d) => d.date)).toEqual(['2026-12-06']);
  });

  it('hỏi ngày trước mốc đã nạp thì đọc database', async () => {
    const { snapshot, calls } = setup(new Map([['A', [room('2026-12-01')]]]));
    await snapshot.refresh();
    await snapshot.loadRoomDays(['A'], '2026-11-30', '2026-12-01');
    expect(calls.fallback).toBe(1);
  });

  it('nạp lại lỗi thì giữ bản cũ', async () => {
    const { snapshot, failOnce } = setup(new Map([['A', [room('2026-12-01', 2)]]]));
    await snapshot.refresh();
    failOnce();
    await snapshot.refresh();
    expect((await snapshot.loadRoomDays(['A'], '2026-12-01', '2026-12-01')).get('A')![0]!.held).toBe(2);
  });

  it('nhiều lượt nạp cùng lúc chỉ chạy một lần', async () => {
    const { snapshot, calls } = setup(new Map());
    await Promise.all([snapshot.refresh(), snapshot.refresh(), snapshot.refresh()]);
    expect(calls.bulk).toBe(1);
  });

  it('chỉ bật với store có hàm nạp cả lịch', () => {
    expect(hasBulkLoad({ loadAllRoomDays: () => null, loadAllFlightDays: () => null })).toBe(true);
    expect(hasBulkLoad({ loadRoomDays: () => null })).toBe(false);
  });
});
