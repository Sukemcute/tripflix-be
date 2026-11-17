import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { findPointsOfInterest, POI_ATTRIBUTION, POI_KINDS } from '../domain/points-of-interest.js';
import { PlacesQuerySchema, PlacesResponseDto } from './dto.js';

/** Điểm tham quan, ăn uống, chỗ ở có toạ độ cho trợ lý Tripi xếp lộ trình (TF31). Công khai, chỉ đọc. */
@ApiTags('discovery')
@Controller('places')
export class PlacesController {
  @Get()
  @ApiOperation({
    summary: 'Điểm tham quan, ăn uống, chỗ ở có toạ độ quanh một thành phố hoặc một toạ độ',
    description: [
      'Dữ liệu © OpenStreetMap contributors (ODbL), nạp sẵn cho các thành phố demo. App phải hiện `attribution` kèm danh sách.',
      '',
      '- Cần `city` (tên có dấu hay không đều được, hoặc id như `vung-tau`) hoặc `near=lat,lng`.',
      '- `lodging` là chỗ ở ngoài Tripflix: chỉ để tham khảo, không có giá, không đặt được.',
      '- Không khớp thành phố thì `items: []` (không phải lỗi).',
    ].join('\n'),
  })
  @ApiBadRequestResponse({ description: 'Thiếu cả `city` lẫn `near`, `near` sai dạng, `kinds` có loại lạ' })
  @ApiQuery({ name: 'city', required: false, example: 'Vũng Tàu' })
  @ApiQuery({ name: 'near', required: false, example: '10.346,107.084' })
  @ApiQuery({ name: 'kinds', required: false, example: 'see,food', description: `Lọc loại: ${POI_KINDS.join(', ')}` })
  @ApiQuery({ name: 'radiusKm', required: false, example: 15, description: '1–50, mặc định 15' })
  @ApiQuery({ name: 'limit', required: false, example: 40, description: '1–100, mặc định 40' })
  @ApiOkResponse({ type: PlacesResponseDto })
  places(@Query() query: Record<string, unknown>): PlacesResponseDto {
    const parsed = PlacesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return { items: findPointsOfInterest(parsed.data), attribution: POI_ATTRIBUTION };
  }
}
