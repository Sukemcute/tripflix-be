import { ApiProperty } from '@nestjs/swagger';
import { CONTENT_VIEW_SURFACES, MAX_WATCHED_MS } from '@tripflix/contracts';
import { z } from 'zod';

/** Lô lớn nhất app được gửi một lần (docs/architecture/10-nghiep-vu-kien-truc-feed.md mục 3.2, F4). */
export const FEED_EVENTS_MAX = 50;

const FeedViewEventSchema = z.object({
  eventId: z.uuid(),
  type: z.literal('view'),
  postId: z.uuid(),
  watchedMs: z.int().min(0).max(MAX_WATCHED_MS),
  surface: z.enum(CONTENT_VIEW_SURFACES),
});

const FeedBookingClickEventSchema = z.object({
  eventId: z.uuid(),
  type: z.literal('booking_click'),
  postId: z.uuid(),
  hotelId: z.string().min(1).max(100).nullable().default(null),
  surface: z.literal('reels_trip_plan'),
});

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
export const FeedEventsRequestSchema = z.object({
  events: z
    .array(z.discriminatedUnion('type', [FeedViewEventSchema, FeedBookingClickEventSchema]))
    .min(1)
    .max(FEED_EVENTS_MAX),
});
export type FeedEventsRequest = z.infer<typeof FeedEventsRequestSchema>;
export type FeedEventInput = FeedEventsRequest['events'][number];

class FeedEventDto {
  @ApiProperty({ format: 'uuid', description: 'App tự sinh; gửi lại cùng mã thì bên nhận coi là một' }) eventId!: string;
  @ApiProperty({ enum: ['view', 'booking_click'] }) type!: 'view' | 'booking_click';
  @ApiProperty({ format: 'uuid' }) postId!: string;
  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: MAX_WATCHED_MS,
    description: 'Chỉ với view: số mili giây đã xem thật (chỉ đếm lúc đang phát)',
  })
  watchedMs?: number;
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    description: 'Chỉ với booking_click: khách sạn trong lộ trình',
  })
  hotelId?: string | null;
  @ApiProperty({ enum: [...CONTENT_VIEW_SURFACES, 'reels_trip_plan'], description: 'view: reels, post_detail; booking_click: reels_trip_plan' })
  surface!: string;
}

export class FeedEventsRequestDto {
  @ApiProperty({ type: [FeedEventDto], minItems: 1, maxItems: FEED_EVENTS_MAX }) events!: FeedEventDto[];
}

export class FeedEventsAcceptedDto {
  @ApiProperty({ description: 'Số sự kiện đã nhận; sự kiện của bài không xem được trên feed bị bỏ qua' }) accepted!: number;
}
