import { Controller, Get, Inject, Query, UnauthorizedException } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '@tripflix/auth';
import type { z } from 'zod';
import { ZodBody } from '../../media/api/http.js';
import { OptionalAuthenticated, OptionalCurrentUser } from '../../social/api/optional-auth.guard.js';
import { FEED_TABS, FeedUseCases, type FeedPage } from '../application/feed.use-cases.js';
import { FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT, FeedPageDto, FeedQuerySchema } from './dto.js';

@ApiTags('feed')
@Controller('v1/feed')
export class FeedController {
  constructor(@Inject(FeedUseCases) private readonly feed: FeedUseCases) {}

  @Get()
  @OptionalAuthenticated()
  @ApiOperation({
    summary:
      'Bảng tin Reels: chỉ gồm bài dạng video phát được. for_you xếp mới nhất trước, hot xếp theo tổng tương tác có trọng số. Khách cũng xem được.',
  })
  @ApiQuery({ name: 'tab', required: false, enum: FEED_TABS })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: FEED_DEFAULT_LIMIT, description: `Tối đa ${FEED_MAX_LIMIT}` })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({
    name: 'saved',
    required: false,
    enum: ['true', 'false'],
    description: 'true: chỉ Reels người xem đã lưu, mới nhất trước. Cần đăng nhập, chỉ dùng với tab for_you',
  })
  @ApiOkResponse({ type: FeedPageDto })
  @ApiBadRequestResponse({ description: 'tab, limit, cursor hoặc saved không hợp lệ' })
  @ApiUnauthorizedResponse({ description: 'saved=true khi chưa đăng nhập' })
  getFeed(
    @Query(new ZodBody(FeedQuerySchema)) query: z.infer<typeof FeedQuerySchema>,
    @OptionalCurrentUser() user?: AuthUser,
  ): Promise<FeedPage> {
    if (query.saved && !user) throw new UnauthorizedException('Cần đăng nhập để xem Reels đã lưu');
    return this.feed.getPage({
      tab: query.tab,
      limit: query.limit,
      after: query.cursor ?? null,
      viewerId: user?.userId ?? null,
      isSavedOnly: query.saved,
    });
  }
}
