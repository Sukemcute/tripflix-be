import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { ZodBody } from '../../media/api/http.js';
import { OptionalAuthenticated, OptionalCurrentUser } from '../../social/api/optional-auth.guard.js';
import { FeedEventsUseCases } from '../application/feed-events.use-cases.js';
import {
  FEED_EVENTS_MAX,
  FeedEventsAcceptedDto,
  FeedEventsRequestDto,
  FeedEventsRequestSchema,
  type FeedEventsRequest,
} from './feed-events.dto.js';

/** Cùng tên header với access (auth/api/http.ts); khai lại ở đây vì module khác không được import vào bên trong access. */
const ANON_ID_HEADER = 'x-anon-id';

@ApiTags('feed')
@Controller('v1/feed/events')
export class FeedEventsController {
  constructor(@Inject(FeedEventsUseCases) private readonly events: FeedEventsUseCases) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @OptionalAuthenticated()
  @ApiOperation({
    summary: `Nhận lô sự kiện hành vi từ app (xem Reels, bấm đặt từ lộ trình), tối đa ${FEED_EVENTS_MAX} sự kiện. Khách cũng gửi được. Chỉ đẩy vào stream:app-events, không ghi bảng nào; sự kiện của bài không xem được trên feed bị bỏ qua.`,
  })
  @ApiHeader({ name: 'X-Anon-Id', required: false, description: 'UUID app sinh cho khách; sai dạng thì bỏ qua' })
  @ApiBody({ type: FeedEventsRequestDto })
  @ApiAcceptedResponse({ type: FeedEventsAcceptedDto })
  @ApiBadRequestResponse({ description: 'Lô rỗng, quá nhiều sự kiện, hoặc sự kiện sai dạng' })
  record(
    @Body(new ZodBody(FeedEventsRequestSchema)) body: FeedEventsRequest,
    @Headers(ANON_ID_HEADER) anonIdHeader?: string,
    @OptionalCurrentUser() user?: AuthUser,
  ): Promise<FeedEventsAcceptedDto> {
    const anonId = z.uuid().safeParse(anonIdHeader);
    return this.events.record({
      events: body.events,
      viewerId: user?.userId ?? null,
      anonId: anonId.success ? anonId.data : null,
    });
  }
}
