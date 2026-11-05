import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { MAX_ADULTS } from '../domain/sales-rules.js';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const HotelDetailQuerySchema = z.object({
  checkIn: IsoDateSchema.optional(),
  checkOut: IsoDateSchema.optional(),
  adults: z.coerce.number().int().min(1).max(MAX_ADULTS).optional(),
  calendarDays: z.coerce.number().int().min(1).max(60).optional(),
});

const UNAVAILABLE_REASONS = ['NOT_ON_SALE', 'STOP_SELL', 'CTA', 'CTD', 'MIN_LOS', 'MAX_LOS', 'SOLD_OUT', 'NOT_ENOUGH_ROOMS'];

class ProvinceDto {
  @ApiProperty({ example: 'da-nang' }) slug!: string;
  @ApiProperty({ example: 'Đà Nẵng' }) name!: string;
}

class StayDto {
  @ApiProperty({ format: 'date', example: '2026-12-01' }) checkIn!: string;
  @ApiProperty({ format: 'date', example: '2026-12-03' }) checkOut!: string;
  @ApiProperty({ example: 2 }) nights!: number;
  @ApiProperty({ example: 2 }) adults!: number;
}

class HotelRatePlanQuoteDto {
  @ApiProperty({ example: 'BB' }) code!: string;
  @ApiProperty({ example: 'Kèm ăn sáng · huỷ miễn phí' }) name!: string;
  @ApiProperty({ example: 'breakfast' }) meal!: string;
  @ApiProperty() isRefundable!: boolean;
  @ApiProperty({ description: 'Huỷ miễn phí trước ngày nhận phòng bao nhiêu ngày' }) freeCancelDays!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Cả kỳ ở, mọi phòng (VND)' }) totalPrice!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Một đêm một phòng (VND)' }) pricePerNight!: number | null;
}

class HotelRoomOfferDto {
  @ApiProperty({ example: 'P-h-dn-01--DLX', description: 'Mã dùng khi đặt chỗ' }) productId!: string;
  @ApiProperty({ example: 'Deluxe hướng vườn' }) name!: string;
  @ApiProperty() maxGuests!: number;
  @ApiProperty({ description: 'Số phòng cần cho số khách đã chọn' }) roomsNeeded!: number;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: String, enum: UNAVAILABLE_REASONS, nullable: true }) reason!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Số phòng thật còn lại suốt kỳ ở' }) remaining!: number | null;
  @ApiProperty({ type: [HotelRatePlanQuoteDto] }) ratePlans!: HotelRatePlanQuoteDto[];
}

class CalendarDayDto {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Giá một đêm rẻ nhất ngày đó (VND)' }) priceFrom!: number | null;
  @ApiProperty() isAvailable!: boolean;
}

export class HotelDetailDto {
  @ApiProperty({ example: 'P-h-dn-01' }) id!: string;
  @ApiProperty({ example: 'Vinpearl Beach Đà Nẵng' }) name!: string;
  @ApiProperty({ type: ProvinceDto }) province!: ProvinceDto;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) stars!: number | null;
  @ApiProperty({ type: String, nullable: true }) brand!: string | null;
  @ApiProperty({ type: String, nullable: true }) style!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Đường dẫn ảnh đại diện' }) thumbnail!: string | null;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: StayDto }) stay!: StayDto;
  @ApiProperty({ type: Number, nullable: true, description: 'Giá một đêm rẻ nhất cho kỳ ở này (VND)' }) priceFrom!: number | null;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: [HotelRoomOfferDto] }) rooms!: HotelRoomOfferDto[];
  @ApiProperty({ type: [CalendarDayDto] }) calendar!: CalendarDayDto[];
}

export class HotelDetailQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Mặc định hôm nay' }) checkIn?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Mặc định ngày nhận phòng + 1' }) checkOut?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ADULTS, default: 2 }) adults?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 14, description: 'Số ngày của lịch giá, tính từ hôm nay' }) calendarDays?: number;
}
