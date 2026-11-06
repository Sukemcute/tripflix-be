// Luật bán và cách tính giá của lịch trống. Hàm thuần, dùng chung cho tra cứu, giữ chỗ và màn quản trị.

export const MAX_NIGHTS = 14;
export const MAX_ROOMS = 9;
export const MAX_ADULTS = 9;

/** Gói giá: hệ số nhân với giá gốc của ngày. */
export interface PricePlan {
  code: string;
  name: string;
  meal: string;
  refundable: boolean;
  freeCancelDays: number;
  priceFactor: number;
  /** Chỉ để hiện giá gạch; không đổi số tiền khách trả. */
  discountPct?: number;
  perks?: string[];
  carryOnKg?: number;
  checkedKg?: number;
}

/** Một ngày của lịch phòng: số phòng, giá gốc và luật bán của ngày nhận phòng. */
export interface RoomDay {
  date: string;
  total: number;
  held: number;
  sold: number;
  price: number;
  isStopSell: boolean;
  isClosedToArrival: boolean;
  isClosedToDeparture: boolean;
  minLos: number;
  maxLos: number;
}

/** Một ngày bay: số ghế và giá một vé. */
export interface FlightDay {
  date: string;
  total: number;
  held: number;
  sold: number;
  price: number;
  isStopSell: boolean;
}

export type UnavailableReason = 'NOT_ON_SALE' | 'STOP_SELL' | 'CTA' | 'CTD' | 'MIN_LOS' | 'MAX_LOS' | 'SOLD_OUT' | 'NOT_ENOUGH_ROOMS';

export type StayQuote =
  | { isAvailable: true; remaining: number; nights: number; totalPrice: number; pricePerNight: number; plan: PricePlan }
  | { isAvailable: false; reason: UnavailableReason; remaining?: number; minLos?: number; maxLos?: number };

/** Giá làm tròn tới 10.000đ, tối thiểu 10.000đ: giá hiển thị cho khách không có số lẻ. */
export const roundToTenThousand = (amount: number) => Math.max(10_000, Math.round(amount / 10_000) * 10_000);

export const calculatePlanPrice = (basePrice: number, plan: PricePlan) => roundToTenThousand(basePrice * plan.priceFactor);

/** Số chỗ còn bán được của một ngày; ngừng bán thì coi như hết. */
export const countRemaining = (day: { total: number; held: number; sold: number; isStopSell: boolean }) =>
  day.isStopSell ? 0 : Math.max(0, day.total - day.held - day.sold);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function countNights(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Ở được từ checkIn tới checkOut với số phòng cần không. days là lịch đã tải sẵn, gồm cả ngày trả phòng để xét CTD.
 * Luật bán xét theo ngày nhận phòng (CTA, số đêm tối thiểu/tối đa) và ngày trả phòng (CTD).
 */
export function quoteStay(input: { days: RoomDay[]; checkIn: string; checkOut: string; rooms: number; plan: PricePlan }): StayQuote {
  const nights = countNights(input.checkIn, input.checkOut);
  const stayDays = input.days.filter((d) => d.date >= input.checkIn && d.date < input.checkOut);
  if (stayDays.length < nights) return { isAvailable: false, reason: 'NOT_ON_SALE' };
  if (stayDays.some((d) => d.isStopSell)) return { isAvailable: false, reason: 'STOP_SELL' };
  const arrival = stayDays[0]!;
  if (arrival.isClosedToArrival) return { isAvailable: false, reason: 'CTA' };
  if (nights < arrival.minLos) return { isAvailable: false, reason: 'MIN_LOS', minLos: arrival.minLos };
  if (nights > arrival.maxLos) return { isAvailable: false, reason: 'MAX_LOS', maxLos: arrival.maxLos };
  if (input.days.find((d) => d.date === input.checkOut)?.isClosedToDeparture) return { isAvailable: false, reason: 'CTD' };
  const remaining = Math.min(...stayDays.map(countRemaining));
  if (remaining < input.rooms) return { isAvailable: false, reason: 'SOLD_OUT', remaining };
  const totalPrice = stayDays.reduce((sum, d) => sum + calculatePlanPrice(d.price, input.plan), 0) * input.rooms;
  return { isAvailable: true, remaining, nights, totalPrice, pricePerNight: Math.round(totalPrice / nights / input.rooms), plan: input.plan };
}

/** Bay được ngày đó với số khách không. */
export function quoteFlight(input: { day: FlightDay | undefined; passengers: number; plan: PricePlan }): StayQuote {
  if (!input.day) return { isAvailable: false, reason: 'NOT_ON_SALE' };
  if (input.day.isStopSell) return { isAvailable: false, reason: 'STOP_SELL' };
  const remaining = countRemaining(input.day);
  if (remaining < input.passengers) return { isAvailable: false, reason: 'SOLD_OUT', remaining };
  const pricePerPerson = calculatePlanPrice(input.day.price, input.plan);
  return { isAvailable: true, remaining, nights: 1, totalPrice: pricePerPerson * input.passengers, pricePerNight: pricePerPerson, plan: input.plan };
}

/** Số phòng tối thiểu để đủ chỗ cho cả nhóm. */
export const countRoomsNeeded = (adults: number, maxGuestsPerRoom: number) => Math.ceil(adults / maxGuestsPerRoom);
