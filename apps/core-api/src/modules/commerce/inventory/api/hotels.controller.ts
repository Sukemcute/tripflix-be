import { Controller, Get, Inject, Param, Query, UseFilters } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { HotelDetailUseCases } from '../application/hotel-detail.use-cases.js';
import { ReviewUseCases } from '../application/review.use-cases.js';
import { HotelDetailDto, HotelDetailQueryDto, HotelDetailQuerySchema, HotelReviewPageDto, HotelReviewQueryDto, HotelReviewQuerySchema } from './dto.js';
import { CommerceErrorFilter, ZodQuery } from './http.js';

/** Trang chi tiết khách sạn cho web và app. Công khai, không cần đăng nhập; chỉ đọc. */
@ApiTags('hotels')
@Controller('hotels')
@UseFilters(CommerceErrorFilter)
export class HotelsController {
  constructor(
    @Inject(HotelDetailUseCases) private readonly hotels: HotelDetailUseCases,
    @Inject(ReviewUseCases) private readonly reviews: ReviewUseCases,
  ) {}

  @Get(':id')
  // Kiểu tham số là giao của DTO và schema zod nên Swagger không tự đọc được: khai báo tường minh.
  @ApiQuery({ type: HotelDetailQueryDto })
  @ApiOkResponse({ type: HotelDetailDto })
  @ApiNotFoundResponse({ description: 'Không có khách sạn này' })
  getHotel(@Param('id') id: string, @Query(new ZodQuery(HotelDetailQuerySchema)) query: HotelDetailQueryDto & z.infer<typeof HotelDetailQuerySchema>) {
    return this.hotels.getHotelDetail(id, query);
  }

  @Get(':id/reviews')
  @ApiOkResponse({ type: HotelReviewPageDto })
  @ApiNotFoundResponse({ description: 'Không có khách sạn này' })
  listReviews(@Param('id') id: string, @Query(new ZodQuery(HotelReviewQuerySchema)) query: HotelReviewQueryDto & z.infer<typeof HotelReviewQuerySchema>) {
    return this.reviews.listHotelReviews(id, query);
  }
}
