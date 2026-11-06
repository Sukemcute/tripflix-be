import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { MAX_ADULTS } from '../domain/sales-rules.js';

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
const AirportCodeSchema = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Mã sân bay gồm 3 chữ cái');
const UNAVAILABLE_REASONS = ['NOT_ON_SALE', 'STOP_SELL', 'SOLD_OUT'];

export const FlightSearchQuerySchema = z.object({
  from: AirportCodeSchema,
  to: AirportCodeSchema,
  date: IsoDateSchema,
  passengers: z.coerce.number().int().min(1).max(MAX_ADULTS).optional(),
});

export const FlightOfferQuerySchema = z.object({
  date: IsoDateSchema,
  passengers: z.coerce.number().int().min(1).max(MAX_ADULTS).optional(),
});

export class FlightSearchQueryDto {
  @ApiProperty({ example: 'SGN', description: 'Mã sân bay đi (IATA)' }) from!: string;
  @ApiProperty({ example: 'CXR', description: 'Mã sân bay đến (IATA)' }) to!: string;
  @ApiProperty({ format: 'date', example: '2026-12-01', description: 'Ngày bay' }) date!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ADULTS, default: 1 }) passengers?: number;
}

export class FlightOfferQueryDto {
  @ApiProperty({ format: 'date', example: '2026-12-01', description: 'Ngày bay' }) date!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ADULTS, default: 1 }) passengers?: number;
}

export class FlightRouteDto {
  @ApiProperty({ example: 'SGN' }) fromAirport!: string;
  @ApiProperty({ example: 'CXR' }) toAirport!: string;
  @ApiProperty({ example: 'nha-trang' }) destinationSlug!: string;
  @ApiProperty({ example: 'Nha Trang' }) destinationName!: string;
  @ApiProperty({ example: 3, description: 'Số chuyến bay trên tuyến (mỗi chuyến có thể nhiều hạng ghế)' }) flightCount!: number;
}

class FlightDestinationDto {
  @ApiProperty({ example: 'nha-trang' }) slug!: string;
  @ApiProperty({ example: 'Nha Trang' }) name!: string;
}

class FlightFareQuoteDto {
  @ApiProperty({ example: 'ECO', description: 'Gửi vào ratePlanCode khi POST /checkout' }) code!: string;
  @ApiProperty({ example: 'Tiết kiệm · không hoàn vé' }) name!: string;
  @ApiProperty() isRefundable!: boolean;
  @ApiProperty({ description: 'Hoàn vé miễn phí trước ngày bay bao nhiêu ngày' }) freeCancelDays!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Giá một vé (VND); null khi không bán được' }) pricePerPerson!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Cả nhóm hành khách (VND); null khi không bán được' }) totalPrice!: number | null;
}

export class FlightOfferDto {
  @ApiProperty({ example: 'P-f-hl-02--Y', description: 'Gửi vào productId khi POST /checkout (checkIn = ngày bay)' }) productId!: string;
  @ApiProperty({ example: 'P-f-hl-02', description: 'Mã chuyến; các hạng ghế của cùng chuyến chung mã này' }) flightKey!: string;
  @ApiProperty({ example: 'Bay Sài Gòn – Nha Trang sớm' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) airline!: string | null;
  @ApiProperty({ example: 'SGN' }) fromAirport!: string;
  @ApiProperty({ example: 'CXR' }) toAirport!: string;
  @ApiProperty({ type: String, nullable: true, example: '06:20' }) departTime!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '07:30' }) arriveTime!: string | null;
  @ApiProperty({ example: 'Phổ thông' }) cabinName!: string;
  @ApiProperty({ type: FlightDestinationDto }) destination!: FlightDestinationDto;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: String, nullable: true, enum: UNAVAILABLE_REASONS }) reason!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Số ghế thật còn lại ngày đó' }) remaining!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Giá một vé rẻ nhất (VND)' }) priceFrom!: number | null;
  @ApiProperty({ type: [FlightFareQuoteDto] }) fares!: FlightFareQuoteDto[];
}

class FlightSearchEchoDto {
  @ApiProperty({ example: 'SGN' }) from!: string;
  @ApiProperty({ example: 'CXR' }) to!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ example: 1 }) passengers!: number;
}

export class FlightSearchResultDto {
  @ApiProperty({ type: FlightSearchEchoDto }) query!: FlightSearchEchoDto;
  @ApiProperty({ type: [FlightOfferDto], description: 'Còn ghế lên trước, rồi theo giờ bay, rồi giá' }) flights!: FlightOfferDto[];
}
