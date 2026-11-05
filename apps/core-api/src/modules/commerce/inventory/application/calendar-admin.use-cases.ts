import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { CommerceError } from '../domain/errors.js';
import { MAX_NIGHTS, countNights, countRemaining, isIsoDate } from '../domain/sales-rules.js';
import { COMMERCE_STORE, type CommerceStore, type FlightCalendarPatch, type RoomCalendarPatch } from './ports.js';

const MAX_RANGE_DAYS = 93;

export interface CalendarRange {
  from: string;
  to: string;
}

export interface AdminRoomDay {
  date: string;
  total: number;
  held: number;
  sold: number;
  remaining: number;
  price: number;
  isStopSell: boolean;
  isClosedToArrival: boolean;
  isClosedToDeparture: boolean;
  minLos: number;
  maxLos: number;
}

export interface AdminFlightDay {
  date: string;
  total: number;
  held: number;
  sold: number;
  remaining: number;
  price: number;
  isStopSell: boolean;
}

function assertRange({ from, to }: CalendarRange) {
  if (!isIsoDate(from)) throw new CommerceError('invalid_query', 'from phải là ngày dạng YYYY-MM-DD.', 'from');
  if (!isIsoDate(to) || to < from) throw new CommerceError('invalid_query', 'to phải là ngày từ from trở đi.', 'to');
  if (countNights(from, to) + 1 > MAX_RANGE_DAYS) throw new CommerceError('invalid_query', `Mỗi lần tối đa ${MAX_RANGE_DAYS} ngày.`, 'to');
}

function assertPatch(patch: RoomCalendarPatch) {
  if (!Object.values(patch).some((v) => v !== undefined)) throw new CommerceError('invalid_query', 'Chưa có trường nào để sửa.');
  if (patch.total !== undefined && (!Number.isInteger(patch.total) || patch.total < 0)) throw new CommerceError('invalid_query', 'Số phòng / ghế phải là số nguyên không âm.', 'total');
  if (patch.price !== undefined && (!Number.isInteger(patch.price) || patch.price <= 0)) throw new CommerceError('invalid_query', 'Giá phải là số nguyên dương (VND).', 'price');
  const { minLos, maxLos } = patch;
  if (minLos !== undefined && (!Number.isInteger(minLos) || minLos < 1 || minLos > MAX_NIGHTS)) throw new CommerceError('invalid_query', `Số đêm tối thiểu từ 1 đến ${MAX_NIGHTS}.`, 'minLos');
  if (maxLos !== undefined && (!Number.isInteger(maxLos) || maxLos < 1 || maxLos > MAX_NIGHTS)) throw new CommerceError('invalid_query', `Số đêm tối đa từ 1 đến ${MAX_NIGHTS}.`, 'maxLos');
  if (minLos !== undefined && maxLos !== undefined && maxLos < minLos) throw new CommerceError('invalid_query', 'Số đêm tối đa phải lớn hơn hoặc bằng tối thiểu.', 'maxLos');
}

/**
 * Màn "Lịch trống & giá" của superadmin. Mỗi lần sửa là một transaction: cập nhật có điều kiện cả khoảng ngày
 * + ghi audit_logs. Thiếu một ngày (chưa mở bán, hoặc giảm số phòng dưới số đã giữ + đã bán) thì không sửa ngày nào.
 */
@Injectable()
export class CalendarAdminUseCases {
  constructor(@Inject(COMMERCE_STORE) private readonly store: CommerceStore) {}

  async getRoomCalendar(roomTypeId: string, range: CalendarRange): Promise<AdminRoomDay[]> {
    assertRange(range);
    if (!(await this.store.catalog.findRoomTypesByIds([roomTypeId])).length) throw new CommerceError('not_found', 'Không có loại phòng này.');
    const days = (await this.store.calendar.loadRoomDays([roomTypeId], range.from, range.to)).get(roomTypeId) ?? [];
    return days.map((d) => ({ ...d, remaining: countRemaining({ ...d, isStopSell: false }) }));
  }

  async getFlightCalendar(flightId: string, range: CalendarRange): Promise<AdminFlightDay[]> {
    assertRange(range);
    if (!(await this.store.catalog.findFlightsByIds([flightId])).length) throw new CommerceError('not_found', 'Không có hạng ghế này.');
    const days = (await this.store.calendar.loadFlightDays([flightId], range.from, range.to)).get(flightId) ?? [];
    return days.map((d) => ({ ...d, remaining: countRemaining({ ...d, isStopSell: false }) }));
  }

  @Transactional('commerce')
  async updateRoomCalendar(actorUserId: string, roomTypeId: string, range: CalendarRange, patch: RoomCalendarPatch): Promise<{ updatedDays: number }> {
    assertRange(range);
    assertPatch(patch);
    if (!(await this.store.catalog.findRoomTypesByIds([roomTypeId])).length) throw new CommerceError('not_found', 'Không có loại phòng này.');
    const expected = countNights(range.from, range.to) + 1;
    if ((await this.store.admin.countRoomDays(roomTypeId, range.from, range.to)) < expected) {
      throw new CommerceError('conflict', 'Có ngày trong khoảng chưa mở bán; chọn khoảng trong 180 ngày tới.');
    }
    const updatedDays = await this.store.admin.updateRoomDays(roomTypeId, range.from, range.to, patch);
    if (updatedDays < expected) {
      const dates = await this.store.admin.findOverbookedRoomDates(roomTypeId, range.from, range.to, patch.total!);
      throw new CommerceError('conflict', `Không giảm được số phòng dưới số đã giữ + đã bán ở ${dates.length} ngày: ${dates.slice(0, 5).join(', ')}.`, 'total', { dates });
    }
    await this.store.admin.insertAuditLog({ actorUserId, action: 'room_calendar.updated', entityType: 'room_type', entityId: roomTypeId, changes: { ...range, ...patch } });
    return { updatedDays };
  }

  @Transactional('commerce')
  async updateFlightCalendar(actorUserId: string, flightId: string, range: CalendarRange, patch: FlightCalendarPatch): Promise<{ updatedDays: number }> {
    assertRange(range);
    assertPatch(patch);
    if (!(await this.store.catalog.findFlightsByIds([flightId])).length) throw new CommerceError('not_found', 'Không có hạng ghế này.');
    const expected = countNights(range.from, range.to) + 1;
    if ((await this.store.admin.countFlightDays(flightId, range.from, range.to)) < expected) {
      throw new CommerceError('conflict', 'Có ngày trong khoảng chưa mở bán; chọn khoảng trong 180 ngày tới.');
    }
    const updatedDays = await this.store.admin.updateFlightDays(flightId, range.from, range.to, patch);
    if (updatedDays < expected) {
      const dates = await this.store.admin.findOverbookedFlightDates(flightId, range.from, range.to, patch.total!);
      throw new CommerceError('conflict', `Không giảm được số ghế dưới số đã giữ + đã bán ở ${dates.length} ngày: ${dates.slice(0, 5).join(', ')}.`, 'total', { dates });
    }
    await this.store.admin.insertAuditLog({ actorUserId, action: 'flight_calendar.updated', entityType: 'flight', entityId: flightId, changes: { ...range, ...patch } });
    return { updatedDays };
  }
}
