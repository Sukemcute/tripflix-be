import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CommerceError } from '../../../commerce/index.js';
import { StaysUseCases } from '../application/stays.use-cases.js';
import { STAY_SORTS } from '../domain/stays.js';
import { ListStaysQuerySchema, StayPageDto } from './dto.js';

const invalid = (errors: { field: string; message: string }[]) => new BadRequestException({ message: 'Tham số không hợp lệ', errors });

/** Trang kết quả của web OTA (kiểu Traveloka): khách sạn còn phòng ở một nơi cho ngày đã chọn. Công khai. */
@ApiTags('discovery')
@Controller('stays')
export class StaysController {
  constructor(@Inject(StaysUseCases) private readonly stays: StaysUseCases) {}

  @Get()
  @ApiOperation({
    summary: 'Khách sạn còn phòng ở một nơi cho ngày đã chọn (trang kết quả web OTA)',
    description: [
      'Gọi sau khi người dùng chọn một địa điểm ở `/api/suggest` (dùng `refId` của dòng `place` làm `placeId`) và chọn ngày, số khách. Công khai.',
      '',
      '- Chọn tỉnh thì gồm cả các điểm đến trong tỉnh (Lâm Đồng gồm Đà Lạt); chọn điểm đến thì chỉ điểm đến đó.',
      '- Chỉ trả khách sạn **còn phòng** cho đúng ngày và số khách; giá là giá thật từ commerce, gói giá mặc định.',
      '- Lọc `minStars` (từ X sao trở lên), `stars` (đúng X sao; gửi cả hai thì áp cả hai), `priceMin`/`priceMax` theo giá một đêm một phòng.',
      '- `sort=price` (mặc định, rẻ trước), `price_desc` (đắt trước) hoặc `stars` (nhiều sao trước).',
      '- Không phải tìm theo chữ: muốn tìm theo tên thì dùng `/api/suggest`.',
    ].join('\n'),
  })
  @ApiBadRequestResponse({ description: 'Thiếu hoặc sai tham số, nơi không tồn tại, ngày nhận phòng trước hôm nay, ở quá số đêm cho phép' })
  @ApiQuery({ name: 'placeId', example: 'lam-dong', description: '`refId` của dòng `place` trong `/api/suggest`' })
  @ApiQuery({ name: 'checkIn', example: '2026-12-01' })
  @ApiQuery({ name: 'checkOut', example: '2026-12-03' })
  @ApiQuery({ name: 'adults', example: 2 })
  @ApiQuery({ name: 'rooms', required: false, description: 'Bỏ trống thì commerce tự tính theo số khách' })
  @ApiQuery({ name: 'minStars', required: false, example: 4, description: 'Từ X sao trở lên' })
  @ApiQuery({ name: 'stars', required: false, example: 3, description: 'Đúng X sao (1–5)' })
  @ApiQuery({ name: 'priceMin', required: false, description: 'VND, một đêm một phòng' })
  @ApiQuery({ name: 'priceMax', required: false, example: 2_000_000, description: 'VND, một đêm một phòng' })
  @ApiQuery({ name: 'sort', required: false, enum: STAY_SORTS })
  @ApiQuery({ name: 'cursor', required: false, description: '`nextCursor` của trang trước' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: '1–50, mặc định 20' })
  @ApiOkResponse({ type: StayPageDto })
  async listStays(@Query() query: Record<string, unknown>): Promise<StayPageDto> {
    const parsed = ListStaysQuerySchema.safeParse(query);
    if (!parsed.success) throw invalid(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    try {
      const page = await this.stays.listStays(parsed.data);
      if (!page) throw invalid([{ field: 'placeId', message: 'Không có địa điểm này' }]);
      return page;
    } catch (err) {
      if (err instanceof CommerceError && err.code === 'invalid_query') throw invalid([{ field: err.field ?? '', message: err.message }]);
      throw err;
    }
  }
}
