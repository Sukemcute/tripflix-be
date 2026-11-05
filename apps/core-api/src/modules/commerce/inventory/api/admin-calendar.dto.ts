import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const CalendarRangeQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema });

const RangeSchema = { from: IsoDateSchema, to: IsoDateSchema };
const Total = z.number().int().min(0).max(10_000).optional();
const Price = z.number().int().positive().max(1_000_000_000).optional();

export const UpdateRoomCalendarRequestSchema = z
  .object({
    ...RangeSchema,
    total: Total,
    price: Price,
    isStopSell: z.boolean().optional(),
    isClosedToArrival: z.boolean().optional(),
    isClosedToDeparture: z.boolean().optional(),
    minLos: z.number().int().min(1).max(14).optional(),
    maxLos: z.number().int().min(1).max(14).optional(),
  })
  .strict();

export const UpdateFlightCalendarRequestSchema = z
  .object({ ...RangeSchema, total: Total, price: Price, isStopSell: z.boolean().optional() })
  .strict();

export class CalendarRangeQueryDto {
  @ApiProperty({ format: 'date', example: '2026-12-01' }) from!: string;
  @ApiProperty({ format: 'date', example: '2026-12-31', description: 'Tính cả ngày này; tối đa 93 ngày' }) to!: string;
}

export class UpdateRoomCalendarDto extends CalendarRangeQueryDto {
  @ApiPropertyOptional({ description: 'Tổng số phòng mỗi ngày; không được nhỏ hơn số đã giữ + đã bán' }) total?: number;
  @ApiPropertyOptional({ description: 'Giá gốc một đêm (VND), trước hệ số của gói giá' }) price?: number;
  @ApiPropertyOptional() isStopSell?: boolean;
  @ApiPropertyOptional({ description: 'Không nhận phòng vào ngày này' }) isClosedToArrival?: boolean;
  @ApiPropertyOptional({ description: 'Không trả phòng vào ngày này' }) isClosedToDeparture?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 14 }) minLos?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 14 }) maxLos?: number;
}

export class UpdateFlightCalendarDto extends CalendarRangeQueryDto {
  @ApiPropertyOptional({ description: 'Tổng số ghế mỗi ngày; không được nhỏ hơn số đã giữ + đã bán' }) total?: number;
  @ApiPropertyOptional({ description: 'Giá một vé (VND), trước hệ số của gói giá' }) price?: number;
  @ApiPropertyOptional() isStopSell?: boolean;
}

export class UpdateCalendarResultDto {
  @ApiProperty({ example: 31 }) updatedDays!: number;
}

export class AdminRoomDayDto {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty() total!: number;
  @ApiProperty() held!: number;
  @ApiProperty() sold!: number;
  @ApiProperty({ description: 'total - held - sold' }) remaining!: number;
  @ApiProperty({ description: 'Giá gốc một đêm (VND)' }) price!: number;
  @ApiProperty() isStopSell!: boolean;
  @ApiProperty() isClosedToArrival!: boolean;
  @ApiProperty() isClosedToDeparture!: boolean;
  @ApiProperty() minLos!: number;
  @ApiProperty() maxLos!: number;
}

export class AdminFlightDayDto {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty() total!: number;
  @ApiProperty() held!: number;
  @ApiProperty() sold!: number;
  @ApiProperty() remaining!: number;
  @ApiProperty({ description: 'Giá một vé (VND)' }) price!: number;
  @ApiProperty() isStopSell!: boolean;
}
