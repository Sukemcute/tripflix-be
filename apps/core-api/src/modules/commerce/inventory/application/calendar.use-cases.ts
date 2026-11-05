import { Inject, Injectable } from '@nestjs/common';
import { CALENDAR_WINDOW_DAYS, generateFlightDay, generateRoomDay } from '../domain/calendar-generator.js';
import { addDays, countNights } from '../domain/sales-rules.js';
import { COMMERCE_STORE, TODAY, type CommerceStore, type NewFlightDay, type NewRoomDay, type Today } from './ports.js';

const INSERT_BATCH = 5_000;

/** Các ngày còn thiếu để lịch của một sản phẩm đủ tới lastDate: tiếp sau ngày đã mở xa nhất, không động vào ngày đã có. */
function listMissingDates(lastOpened: string | undefined, today: string, lastDate: string): string[] {
  const start = lastOpened && lastOpened >= today ? addDays(lastOpened, 1) : today;
  const count = countNights(start, lastDate) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i));
}

/** Job mở lịch trống: chạy 6 giờ/lần và khi seed, giữ đủ 180 ngày tới cho mọi loại phòng và hạng ghế. */
@Injectable()
export class CalendarUseCases {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(TODAY) private readonly today: Today,
  ) {}

  async openCalendarWindow(windowDays = CALENDAR_WINDOW_DAYS): Promise<{ roomDays: number; flightDays: number }> {
    const today = this.today();
    const lastDate = addDays(today, windowDays - 1);
    const [roomTypes, flights, lastRoomDates, lastFlightDates] = await Promise.all([
      this.store.calendar.listAllRoomTypes(),
      this.store.calendar.listAllFlights(),
      this.store.calendar.findLastOpenedRoomDates(),
      this.store.calendar.findLastOpenedFlightDates(),
    ]);

    const roomBatch: NewRoomDay[] = [];
    let roomDays = 0;
    for (const roomType of roomTypes) {
      for (const date of listMissingDates(lastRoomDates.get(roomType.id), today, lastDate)) {
        roomBatch.push({ roomTypeId: roomType.id, date, ...generateRoomDay(roomType, date) });
        if (roomBatch.length >= INSERT_BATCH) roomDays += await this.store.calendar.insertRoomDays(roomBatch.splice(0));
      }
    }
    if (roomBatch.length) roomDays += await this.store.calendar.insertRoomDays(roomBatch);

    const flightBatch: NewFlightDay[] = [];
    let flightDays = 0;
    for (const flight of flights) {
      for (const date of listMissingDates(lastFlightDates.get(flight.id), today, lastDate)) {
        flightBatch.push({ flightId: flight.id, date, ...generateFlightDay(flight, date, countNights(today, date)) });
        if (flightBatch.length >= INSERT_BATCH) flightDays += await this.store.calendar.insertFlightDays(flightBatch.splice(0));
      }
    }
    if (flightBatch.length) flightDays += await this.store.calendar.insertFlightDays(flightBatch);
    return { roomDays, flightDays };
  }
}
