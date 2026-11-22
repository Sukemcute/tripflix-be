// Sinh giá và luật bán cho một ngày mới mở bán (cửa sổ trượt 180 ngày). Dữ liệu giả lập:
// ngẫu nhiên nhưng cố định theo mã sản phẩm + ngày, nên chạy lại job hay seed lại vẫn ra đúng số cũ.
import { roundToTenThousand } from './sales-rules.js';

export const CALENDAR_WINDOW_DAYS = 180;
const HOLIDAYS = ['12-24', '12-25', '12-31', '01-01', '04-30', '05-01', '09-02'];

function createSeededRandom(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const isHoliday = (date: string) => HOLIDAYS.includes(date.slice(5));

export interface GeneratedRoomDay {
  total: number;
  price: number;
  isStopSell: boolean;
  isClosedToArrival: boolean;
  isClosedToDeparture: boolean;
  minLos: number;
  maxLos: number;
}

/** Ngày phòng mới: đủ số phòng mặc định, cuối tuần và ngày lễ đắt hơn, đôi khi có luật bán. */
export function generateRoomDay(roomType: { id: string; defaultTotal: number; defaultPrice: number; stars: number | null }, date: string): GeneratedRoomDay {
  const random = createSeededRandom(`room:${roomType.id}:${date}`);
  const weekday = weekdayOf(date);
  const isWeekend = weekday === 5 || weekday === 6;
  let factor = 1;
  if (isHoliday(date)) factor *= 1.5;
  if (isWeekend) factor *= 1.2;
  let minLos = 1;
  if (isHoliday(date)) minLos = 2;
  if (weekday === 6 && (roomType.stars ?? 0) >= 5 && random() < 0.3) minLos = 2;
  return {
    total: roomType.defaultTotal,
    price: roundToTenThousand(roomType.defaultPrice * factor),
    isStopSell: random() < 0.02,
    isClosedToArrival: random() < 0.04,
    isClosedToDeparture: random() < 0.03,
    minLos,
    maxLos: 14,
  };
}

/** Ngày bay mới: thứ Sáu, Chủ nhật và ngày lễ đắt hơn; càng gần ngày bay càng đắt. */
export function generateFlightDay(flight: { id: string; defaultSeats: number; defaultPrice: number }, date: string, daysAhead: number) {
  const random = createSeededRandom(`flight:${flight.id}:${date}`);
  const weekday = weekdayOf(date);
  let factor = 1;
  if (isHoliday(date)) factor *= 1.5;
  if (weekday === 5 || weekday === 0) factor *= 1.1;
  if (daysAhead < 14) factor *= 1 + (14 - daysAhead) * 0.03;
  return { total: flight.defaultSeats, price: roundToTenThousand(flight.defaultPrice * factor), isStopSell: random() < 0.02 };
}
