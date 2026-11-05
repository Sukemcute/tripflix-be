import { Body, Controller, Get, Inject, Param, Patch, Query, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConflictResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import type { z } from 'zod';
import { CalendarAdminUseCases } from '../application/calendar-admin.use-cases.js';
import {
  AdminFlightDayDto,
  AdminRoomDayDto,
  CalendarRangeQueryDto,
  CalendarRangeQuerySchema,
  UpdateCalendarResultDto,
  UpdateFlightCalendarDto,
  UpdateFlightCalendarRequestSchema,
  UpdateRoomCalendarDto,
  UpdateRoomCalendarRequestSchema,
} from './admin-calendar.dto.js';
import { CommerceErrorFilter, ZodQuery } from './http.js';

/** Màn "Lịch trống & giá" trong trang quản trị: xem và sửa giá, số phòng / ghế, luật bán theo khoảng ngày. Chỉ superadmin. */
@ApiTags('admin-commerce')
@ApiBearerAuth()
@Controller('admin/commerce')
@UseFilters(CommerceErrorFilter)
@Roles('superadmin')
export class AdminCalendarController {
  constructor(@Inject(CalendarAdminUseCases) private readonly calendar: CalendarAdminUseCases) {}

  @Get('room-types/:id/calendar')
  @ApiOkResponse({ type: AdminRoomDayDto, isArray: true })
  getRoomCalendar(@Param('id') id: string, @Query(new ZodQuery(CalendarRangeQuerySchema)) query: CalendarRangeQueryDto) {
    return this.calendar.getRoomCalendar(id, query);
  }

  @Patch('room-types/:id/calendar')
  @ApiBody({ type: UpdateRoomCalendarDto })
  @ApiOkResponse({ type: UpdateCalendarResultDto })
  @ApiConflictResponse({ description: 'Có ngày chưa mở bán, hoặc giảm số phòng dưới số đã giữ + đã bán (kèm danh sách ngày)' })
  updateRoomCalendar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodQuery(UpdateRoomCalendarRequestSchema)) body: z.infer<typeof UpdateRoomCalendarRequestSchema>,
  ) {
    const { from, to, ...patch } = body;
    return this.calendar.updateRoomCalendar(user.userId, id, { from, to }, patch);
  }

  @Get('flights/:id/calendar')
  @ApiOkResponse({ type: AdminFlightDayDto, isArray: true })
  getFlightCalendar(@Param('id') id: string, @Query(new ZodQuery(CalendarRangeQuerySchema)) query: CalendarRangeQueryDto) {
    return this.calendar.getFlightCalendar(id, query);
  }

  @Patch('flights/:id/calendar')
  @ApiBody({ type: UpdateFlightCalendarDto })
  @ApiOkResponse({ type: UpdateCalendarResultDto })
  @ApiConflictResponse({ description: 'Có ngày chưa mở bán, hoặc giảm số ghế dưới số đã giữ + đã bán (kèm danh sách ngày)' })
  updateFlightCalendar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodQuery(UpdateFlightCalendarRequestSchema)) body: z.infer<typeof UpdateFlightCalendarRequestSchema>,
  ) {
    const { from, to, ...patch } = body;
    return this.calendar.updateFlightCalendar(user.userId, id, { from, to }, patch);
  }
}
