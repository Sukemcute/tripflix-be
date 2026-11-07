// Luật bán và cách tính giá của lịch trống. Hàm thuần, dùng chung cho tra cứu, giữ chỗ và màn quản trị.

export const MAX_NIGHTS = 14;
export const MAX_ROOMS = 9;
export const MAX_ADULTS = 9;
/** Ghế tối đa của một lượt đặt vé bay: người lớn + trẻ em (em bé ngồi lòng người lớn, không chiếm ghế). */
export const MAX_SEATS = 9;
/** Trẻ em 2–11 tuổi trả 75% giá vé người lớn, em bé dưới 2 tuổi trả 10% (TF29). */
export const CHILD_FARE_FACTOR = 0.75;
export const INFANT_FARE_FACTOR = 0.1;

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

/** Nhóm hành khách của một lượt bay. */
export interface PassengerMix {
  adults: number;
  children: number;
  infants: number;
}

/** Số ghế cần giữ: em bé ngồi lòng người lớn nên không tính. */
export const countSeats = (mix: PassengerMix) => mix.adults + mix.children;

/** Lỗi đầu tiên của nhóm khách, kèm tên trường; null khi hợp lệ. */
export function findPassengerMixError(mix: PassengerMix): { field: 'adults' | 'children' | 'infants'; message: string } | null {
  const isCount = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max;
  if (!isCount(mix.adults, MAX_ADULTS) || mix.adults < 1) return { field: 'adults', message: `Số người lớn từ 1 đến ${MAX_ADULTS}.` };
  if (!isCount(mix.children, MAX_SEATS - 1)) return { field: 'children', message: `Số trẻ em từ 0 đến ${MAX_SEATS - 1}.` };
  if (countSeats(mix) > MAX_SEATS) return { field: 'children', message: `Người lớn và trẻ em tối đa ${MAX_SEATS} ghế.` };
  if (!isCount(mix.infants, mix.adults)) return { field: 'infants', message: 'Mỗi em bé cần một người lớn đi kèm.' };
  return null;
}

/** Giá một vé của từng loại khách, từ giá người lớn của gói; làm tròn 10.000đ như giá người lớn. */
export const calculatePassengerFares = (adultPrice: number) => ({
  adult: adultPrice,
  child: roundToTenThousand(adultPrice * CHILD_FARE_FACTOR),
  infant: roundToTenThousand(adultPrice * INFANT_FARE_FACTOR),
});

/**
 * Bay được ngày đó với nhóm khách không. passengers là số người lớn; trẻ em chiếm ghế, em bé không.
 * pricePerNight là giá một vé người lớn, totalPrice là cả nhóm.
 */
export function quoteFlight(input: { day: FlightDay | undefined; passengers: number; children?: number; infants?: number; plan: PricePlan }): StayQuote {
  const children = input.children ?? 0;
  const infants = input.infants ?? 0;
  if (!input.day) return { isAvailable: false, reason: 'NOT_ON_SALE' };
  if (input.day.isStopSell) return { isAvailable: false, reason: 'STOP_SELL' };
  const remaining = countRemaining(input.day);
  if (remaining < input.passengers + children) return { isAvailable: false, reason: 'SOLD_OUT', remaining };
  const fares = calculatePassengerFares(calculatePlanPrice(input.day.price, input.plan));
  const totalPrice = fares.adult * input.passengers + fares.child * children + fares.infant * infants;
  return { isAvailable: true, remaining, nights: 1, totalPrice, pricePerNight: fares.adult, plan: input.plan };
}

/** Số phòng tối thiểu để đủ chỗ cho cả nhóm. */
export const countRoomsNeeded = (adults: number, maxGuestsPerRoom: number) => Math.ceil(adults / maxGuestsPerRoom);
