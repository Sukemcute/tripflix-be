import type { OrderStatus } from './order-rules.js';

/**
 * Trạng thái chuyến để hiển thị (TF37), tính lúc đọc từ trạng thái đơn và ngày kết thúc chuyến; không phải trạng thái của
 * máy trạng thái thanh toán. Chỉ đơn còn `paid` mới có: đơn đã huỷ / hoàn tiền giữ nhãn huỷ của nó.
 */
export type TripStatus = 'upcoming' | 'completed';

/**
 * `endDate`: ngày muộn nhất của đơn (ngày trả phòng, ngày bay chặng cuối). `today`: ngày hôm nay theo giờ Việt Nam.
 * Đã đi khi hôm nay đã qua ngày kết thúc: ngày trả phòng / ngày bay về vẫn tính là đang đi.
 */
export function computeTripStatus(order: { status: OrderStatus; endDate: string | null }, today: string): TripStatus | null {
  if (order.status !== 'paid' || !order.endDate) return null;
  return today > order.endDate ? 'completed' : 'upcoming';
}

/** Ngày muộn nhất trong các mục (dateTo: phòng là ngày trả phòng, vé bay là ngày bay). */
export const findEndDate = (items: readonly { dateTo: string }[]): string | null =>
  items.reduce<string | null>((max, i) => (max === null || i.dateTo > max ? i.dateTo : max), null);

/** Giờ nhận phòng mặc định khi đơn không lưu giờ: nhắc 24h trước tính từ mốc này. */
const DEFAULT_CHECK_IN_TIME = '14:00';
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEPARTURE_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Lúc bắt đầu chuyến (giờ Việt Nam, UTC+7): sớm nhất giữa giờ nhận phòng và giờ cất cánh; vé bay thiếu giờ thì lấy 00:00. */
export function computeTripStartAt(items: readonly { productType: 'room' | 'flight'; date: string; departTime?: string | null }[]): Date | null {
  const starts = items.map((i) => {
    const time = i.productType === 'room' ? DEFAULT_CHECK_IN_TIME : i.departTime && HH_MM.test(i.departTime) ? i.departTime : '00:00';
    return new Date(`${i.date}T${time}:00+07:00`).getTime();
  });
  return starts.length ? new Date(Math.min(...starts)) : null;
}

/** Đến lúc nhắc: chuyến chưa bắt đầu và còn không quá 24 giờ. Đơn đặt sát giờ vẫn được nhắc một lần. */
export const isDueForDepartureReminder = (startAt: Date, now: Date): boolean =>
  startAt.getTime() > now.getTime() && startAt.getTime() - now.getTime() <= DEPARTURE_REMINDER_WINDOW_MS;
