import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HomeRecommendationUseCases } from '../application/home-recommendations.use-cases.js';
import { MAX_RECENT_PLACES, type HomeReasonCode } from '../domain/home-picks.js';

export const HomeRecommendationQuerySchema = z.object({
  // "da-lat,phu-quoc": mới nhất trước. Nơi lạ thì bỏ qua, không báo lỗi, vì web lưu ở trình duyệt có thể cũ.
  recentPlaceIds: z
    .string()
    .optional()
    .transform((raw) => (raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().max(64)).max(10)),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

class HomeReasonDto {
  @ApiProperty({ enum: ['recent_place', 'good_deal'], description: 'recent_place: nơi vừa tìm · good_deal: rẻ hơn trung vị cùng hạng sao' })
  code!: HomeReasonCode;
  @ApiProperty({ example: 'Vì bạn vừa tìm Đà Lạt', description: 'Câu hiện dưới thẻ, tiếng Việt' }) text!: string;
}

class HomeProvinceDto {
  @ApiProperty({ example: 'da-lat' }) slug!: string;
  @ApiProperty({ example: 'Đà Lạt' }) name!: string;
}

export class HomePickDto {
  @ApiProperty({ example: 'P-vn-h-da-lat-3', description: 'Mã khách sạn của commerce; mở trang chi tiết bằng mã này' }) hotelId!: string;
  @ApiProperty({ example: 'Swiss-Belresort Tuyền Lâm' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) thumbnail!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 5 }) stars!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'Mường Thanh', description: 'Chuỗi khách sạn; null nếu độc lập' })
  brand!: string | null;
  @ApiProperty({ type: HomeProvinceDto }) province!: HomeProvinceDto;
  @ApiProperty({ example: 2_750_000, description: 'Giá thấp nhất một đêm một phòng trong 30 ngày tới (VND), hiện "từ X/đêm"' })
  priceFrom!: number;
  @ApiProperty({ type: HomeReasonDto }) reason!: HomeReasonDto;
}

export class HomeRecommendationsDto {
  @ApiProperty({ type: [HomePickDto], description: 'Có thể rỗng: chưa có nơi vừa tìm và không có khách sạn nào giá tốt' })
  items!: HomePickDto[];
}

/** Khối "Gợi ý dành cho bạn" trên trang chủ web. Công khai; không theo dõi người dùng ở server. */
@ApiTags('discovery')
@Controller('recommendations')
export class HomeRecommendationsController {
  constructor(@Inject(HomeRecommendationUseCases) private readonly recommendations: HomeRecommendationUseCases) {}

  @Get('home')
  @ApiOperation({
    summary: 'Gợi ý khách sạn cho trang chủ web, mỗi gợi ý kèm lý do ngắn',
    description: [
      'Công khai, không cần đăng nhập. Server không lưu gì về người dùng.',
      '',
      `- \`recentPlaceIds\`: các nơi người dùng vừa chọn ở \`/api/suggest\` (\`refId\` của dòng \`place\`), web tự nhớ ở trình duyệt, mới nhất trước. Dùng tối đa ${MAX_RECENT_PLACES} nơi, mỗi nơi 2 khách sạn: lý do "Vì bạn vừa tìm …".`,
      '- Phần còn lại là khách sạn rẻ hơn giá trung bình cùng hạng sao từ 10%, mỗi tỉnh một khách sạn: lý do "Rẻ hơn X% so với …".',
      '- Giá là "từ X/đêm" trong 30 ngày tới; còn phòng và giá thật cho ngày cụ thể xem ở trang chi tiết hoặc `/api/stays`.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'recentPlaceIds', required: false, example: 'da-lat,phu-quoc', description: 'CSV, tối đa 10; nơi lạ bị bỏ qua' })
  @ApiQuery({ name: 'limit', required: false, example: 8, description: '1–20, mặc định 8' })
  @ApiBadRequestResponse({ description: '`limit` ngoài 1–20 hoặc quá 10 nơi' })
  @ApiOkResponse({ type: HomeRecommendationsDto })
  async recommendForHome(@Query() query: Record<string, unknown>): Promise<HomeRecommendationsDto> {
    const parsed = HomeRecommendationQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return { items: await this.recommendations.recommendForHome(parsed.data) };
  }
}
