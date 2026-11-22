import { Controller, Get, Inject, Param, Query, UseFilters } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { HotelDetailUseCases } from '../application/hotel-detail.use-cases.js';
import { ReviewUseCases } from '../application/review.use-cases.js';
import { HotelDetailDto, HotelDetailQueryDto, HotelDetailQuerySchema, HotelReviewPageDto, HotelReviewQueryDto, HotelReviewQuerySchema } from './dto.js';
import { CommerceErrorFilter, ZodQuery } from './http.js';
import { TtlCache } from '../application/ttl-cache.js';
import type { HotelDetail } from '../application/hotel-detail.use-cases.js';
import { isDatabaseUnavailable } from './database-unavailable.js';

/**
 * Trang khách sạn đọc nhiều, ít đổi: giữ 10 giây. Database lỗi thì trả bản tốt gần nhất (cũ tối đa 30 phút)
 * thay vì báo lỗi; giữ chỗ vẫn kiểm tồn kho thật nên giá, phòng hiển thị cũ không làm bán sai.
 */
const HOTEL_DETAIL_TTL_MS = 10_000;
const HOTEL_DETAIL_STALE_MS = 30 * 60_000;
const MAX_HOTEL_DETAIL_ENTRIES = 2_000;

/** Trang chi tiết khách sạn cho web và app. Công khai, không cần đăng nhập; chỉ đọc. */
@ApiTags('hotels')
@Controller('hotels')
@UseFilters(CommerceErrorFilter)
export class HotelsController {
  constructor(
    @Inject(HotelDetailUseCases) private readonly hotels: HotelDetailUseCases,
    @Inject(ReviewUseCases) private readonly reviews: ReviewUseCases,
  ) {}

  private readonly detailCache = new TtlCache<HotelDetail>({
    ttlMs: HOTEL_DETAIL_TTL_MS,
    maxEntries: MAX_HOTEL_DETAIL_ENTRIES,
    staleMs: HOTEL_DETAIL_STALE_MS,
    canServeStale: isDatabaseUnavailable,
  });

  @Get(':slug')
  // Kiểu tham số là giao của DTO và schema zod nên Swagger không tự đọc được: khai báo tường minh.
  @ApiQuery({ type: HotelDetailQueryDto })
  @ApiOkResponse({ type: HotelDetailDto })
  @ApiNotFoundResponse({ description: 'Không có khách sạn này' })
  getHotel(@Param('slug') slug: string, @Query(new ZodQuery(HotelDetailQuerySchema)) query: HotelDetailQueryDto & z.infer<typeof HotelDetailQuerySchema>) {
    return this.detailCache.get(JSON.stringify([slug, query]), () => this.hotels.getHotelDetail(slug, query));
  }

  @Get(':slug/reviews')
  @ApiOkResponse({ type: HotelReviewPageDto })
  @ApiNotFoundResponse({ description: 'Không có khách sạn này' })
  listReviews(@Param('slug') slug: string, @Query(new ZodQuery(HotelReviewQuerySchema)) query: HotelReviewQueryDto & z.infer<typeof HotelReviewQuerySchema>) {
    return this.reviews.listHotelReviews(slug, query);
  }
}
