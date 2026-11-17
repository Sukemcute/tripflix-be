import { BadRequestException, Controller, Get, HttpException, HttpStatus, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CommerceError, DATABASE_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS, isDatabaseUnavailable } from '../../../commerce/index.js';
import { TripBuilderUseCases } from '../application/trip-builder.use-cases.js';
import { FLIGHT_SORTS, STAY_SUGGEST_SORTS } from '../domain/trip-builder.js';
import {
  FlightSuggestionsDto,
  StaySuggestionsDto,
  SuggestFlightsQuerySchema,
  SuggestStaysQuerySchema,
} from './trip-builder.dto.js';

const invalid = (errors: { field: string; message: string }[]) => new BadRequestException({ message: 'Tham số không hợp lệ', errors });

/**
 * Gợi ý vé bay và chỗ ở khi khách tự lên lộ trình ở tab Đặt của app (TF105). Công khai.
 * App chọn một lựa chọn rồi gửi `productId`/`roomProductId` + `ratePlanCode` lên POST /checkout như đặt thường.
 */
@ApiTags('discovery')
@Controller('trip-builder')
export class TripBuilderController {
  constructor(@Inject(TripBuilderUseCases) private readonly tripBuilder: TripBuilderUseCases) {}

  @Get('flights')
  @ApiOperation({
    summary: 'Gợi ý vé bay chiều đi và chiều về tới một nơi',
    description: [
      '`place` là `refId` của dòng `place` trong `/api/suggest`; `from` là sân bay nhà của khách.',
      '- Chỉ chuyến còn chỗ cho đúng ngày; giá là hạng ghế rẻ nhất còn bán.',
      '- `sort=cheapest` (rẻ trước) hoặc `best_time` (chiều đi tới kịp nhận phòng, chiều về còn trọn buổi sáng cuối lên trước).',
      '- `reason` là câu ngắn hiện dưới lựa chọn, có thể null.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'place', example: 'nha-trang' })
  @ApiQuery({ name: 'from', example: 'SGN' })
  @ApiQuery({ name: 'departDate', example: '2026-12-01' })
  @ApiQuery({ name: 'returnDate', required: false, example: '2026-12-03' })
  @ApiQuery({ name: 'adults', example: 2 })
  @ApiQuery({ name: 'sort', required: false, enum: FLIGHT_SORTS })
  @ApiQuery({ name: 'limit', required: false, example: 5, description: '1–20 mỗi chiều, mặc định 5' })
  @ApiOkResponse({ type: FlightSuggestionsDto })
  @ApiBadRequestResponse({ description: 'Thiếu hoặc sai tham số, nơi hay sân bay không tồn tại' })
  async suggestFlights(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response): Promise<FlightSuggestionsDto> {
    const parsed = SuggestFlightsQuerySchema.safeParse(query);
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const result = await this.withCommerceErrors(res, () => this.tripBuilder.suggestFlights(parsed.data));
    if (!result) throw invalid([{ field: 'place', message: 'Không có nơi đến hoặc sân bay này' }]);
    return result;
  }

  @Get('stays')
  @ApiOperation({
    summary: 'Gợi ý chỗ ở còn phòng ở một nơi',
    description: [
      '`place` là `refId` của dòng `place` trong `/api/suggest`. Chỉ khách sạn còn phòng, giá thật từ commerce.',
      '- `sort=best_price` (rẻ một đêm trước) hoặc `top_rated` (điểm đánh giá cao trước).',
    ].join('\n'),
  })
  @ApiQuery({ name: 'place', example: 'nha-trang' })
  @ApiQuery({ name: 'checkIn', example: '2026-12-01' })
  @ApiQuery({ name: 'checkOut', example: '2026-12-03' })
  @ApiQuery({ name: 'adults', example: 2 })
  @ApiQuery({ name: 'sort', required: false, enum: STAY_SUGGEST_SORTS })
  @ApiQuery({ name: 'limit', required: false, example: 5, description: '1–20, mặc định 5' })
  @ApiOkResponse({ type: StaySuggestionsDto })
  @ApiBadRequestResponse({ description: 'Thiếu hoặc sai tham số, nơi không tồn tại' })
  async suggestStays(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response): Promise<StaySuggestionsDto> {
    const parsed = SuggestStaysQuerySchema.safeParse(query);
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const items = await this.withCommerceErrors(res, () => this.tripBuilder.suggestStays(parsed.data));
    if (!items) throw invalid([{ field: 'place', message: 'Không có nơi này' }]);
    return { items };
  }

  /** Cùng cách báo lỗi với /api/stays: ngày, số khách sai thì 400; database bận thì 503 kèm Retry-After. */
  private async withCommerceErrors<T>(res: Response, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof CommerceError && err.code === 'invalid_query') throw invalid([{ field: err.field ?? '', message: err.message }]);
      if (isDatabaseUnavailable(err)) {
        res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
        throw new HttpException(
          { statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: DATABASE_UNAVAILABLE_MESSAGE, reason: 'SERVICE_UNAVAILABLE', error: 'Service Unavailable' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw err;
    }
  }
}
