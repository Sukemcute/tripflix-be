import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { TripItineraryItemDto } from '../../social/api/dto/post.dto.js';
import type { SavedItineraryRecord } from '../../db/schema/index.js';
import { MAX_ITINERARY_DAYS, MAX_ITINERARY_ITEMS, MAX_TITLE_LENGTH } from '../domain/saved-itinerary.js';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SlotSchema = z.enum(['sáng', 'trưa', 'chiều', 'tối']);
const CategorySchema = z.enum(['cafe', 'food', 'fun', 'other']);
const AirportSchema = z.string().regex(/^[A-Z]{3}$/);

export const SavedItineraryItemSchema = z.object({
  day: z.number().int().min(1).max(MAX_ITINERARY_DAYS),
  title: z.string().trim().min(1).max(120),
  location: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
  time: z.string().regex(HH_MM).optional(),
  category: CategorySchema.optional(),
  hotel: z.object({ hotelId: z.string().min(1).max(100), productId: z.string().max(100).optional(), ratePlanCode: z.string().max(40).optional() }).optional(),
  transport: z.object({ mode: z.enum(['flight', 'bus', 'train', 'car', 'other']), fromAirport: AirportSchema.optional(), toAirport: AirportSchema.optional() }).optional(),
  slot: SlotSchema.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  placeId: z.string().max(100).optional(),
  nights: z.number().int().min(1).max(30).optional(),
});

const TripiTransportSchema = z.object({
  mode: z.enum(['flight', 'bus']),
  summary: z.string().max(160),
  fromAirport: AirportSchema.nullish(),
  toAirport: AirportSchema.nullish(),
});

const TripiStopSchema = z.object({ id: z.string().max(100), name: z.string().min(1).max(120), lat: z.number().optional(), lng: z.number().optional(), slot: SlotSchema.optional() });

const BuilderItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hotel'),
    checkIn: z.string().regex(ISO_DATE),
    nights: z.number().int().min(1).max(30),
    hotelId: z.string().min(1),
    hotelName: z.string().min(1).max(120),
    productId: z.string().optional(),
    ratePlanCode: z.string().optional(),
  }),
  z.object({ kind: z.literal('flight'), date: z.string().regex(ISO_DATE), from: AirportSchema, to: AirportSchema, departTime: z.string().nullish() }),
  z.object({
    kind: z.literal('activity'),
    date: z.string().regex(ISO_DATE),
    time: z.string().regex(HH_MM).optional(),
    title: z.string().min(1).max(120),
    category: CategorySchema.optional(),
    detail: z.string().max(200).optional(),
  }),
]);

export const SaveItineraryRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('reel'), postId: z.uuid() }),
  z.object({
    source: z.literal('tripi'),
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
    trip: z.object({
      place: z.string().max(100).optional(),
      days: z.array(z.array(TripiStopSchema).max(12)).max(MAX_ITINERARY_DAYS).optional(),
      stay: z.object({ source: z.enum(['tripflix', 'external']), id: z.string().max(100), name: z.string().min(1).max(120) }).nullish(),
      transport: TripiTransportSchema.nullish(),
      returnTransport: TripiTransportSchema.nullish(),
    }),
  }),
  z.object({
    source: z.literal('builder'),
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
    builder: z.object({
      destinationName: z.string().max(120).optional(),
      destinationPlaceId: z.string().max(100).optional(),
      startDate: z.string().regex(ISO_DATE).optional(),
      dayCount: z.number().int().min(0).max(MAX_ITINERARY_DAYS).optional(),
      items: z.array(BuilderItemSchema).max(MAX_ITINERARY_ITEMS),
    }),
  }),
]);

export const UpdateItineraryRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
    daysCount: z.number().int().min(1).max(MAX_ITINERARY_DAYS).optional(),
    items: z.array(SavedItineraryItemSchema).min(1).max(MAX_ITINERARY_ITEMS).optional(),
  })
  .refine((v) => v.title !== undefined || v.daysCount !== undefined || v.items !== undefined, 'Cần ít nhất một trường để sửa');

export const ListItinerariesQuerySchema = z.object({ postId: z.uuid().optional() });

export class SavedItineraryItemDto extends TripItineraryItemDto {
  @ApiPropertyOptional({ enum: ['sáng', 'trưa', 'chiều', 'tối'], description: 'Buổi trong ngày khi không có giờ cụ thể (Tripi)' })
  slot?: 'sáng' | 'trưa' | 'chiều' | 'tối';

  @ApiPropertyOptional() lat?: number;
  @ApiPropertyOptional() lng?: number;
  @ApiPropertyOptional({ description: 'Mã địa điểm của discovery (Tripi)' }) placeId?: string;
  @ApiPropertyOptional({ description: 'Điểm khách sạn: số đêm ở' }) nights?: number;
}

export class SavedItineraryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) destinationName!: string | null;
  @ApiProperty({ type: String, nullable: true }) destinationPlaceId!: string | null;
  @ApiProperty({ description: 'Số ngày (Ngày 1..N); ngày đi khách chọn lúc đặt' }) daysCount!: number;
  @ApiProperty({ type: [SavedItineraryItemDto] }) items!: SavedItineraryItemDto[];
  @ApiProperty({ enum: ['reel', 'tripi', 'builder'] }) source!: 'reel' | 'tripi' | 'builder';
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Reel gốc khi lưu từ reel' }) sourcePostId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SavedItineraryListDto {
  @ApiProperty({ type: [SavedItineraryDto], description: 'Mới sửa trước, tối đa 100' }) itineraries!: SavedItineraryDto[];
}

/** Body chỉ để mô tả trong OpenAPI; kiểm thật bằng SaveItineraryRequestSchema. */
export class SaveItineraryRequestDto {
  @ApiProperty({ enum: ['reel', 'tripi', 'builder'] }) source!: 'reel' | 'tripi' | 'builder';
  @ApiPropertyOptional({ format: 'uuid', description: 'source = reel' }) postId?: string;
  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH }) title?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'source = tripi: sự kiện trip của ai-service (place, days, stay, transport, returnTransport)' })
  trip?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'source = builder: lộ trình đang soạn (destinationName, startDate, dayCount, items hotel/flight/activity)' })
  builder?: Record<string, unknown>;
}

export class UpdateItineraryRequestDto {
  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH }) title?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_ITINERARY_DAYS }) daysCount?: number;
  @ApiPropertyOptional({ type: [SavedItineraryItemDto] }) items?: SavedItineraryItemDto[];
}

export const toSavedItineraryDto = (row: SavedItineraryRecord): SavedItineraryDto => ({
  id: row.id,
  title: row.title,
  destinationName: row.destinationName,
  destinationPlaceId: row.destinationPlaceId,
  daysCount: row.daysCount,
  items: row.items,
  source: row.source,
  sourcePostId: row.sourcePostId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
