import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SUGGEST_TYPES } from '../domain/suggest-entity.js';
import { SuggestUseCases } from '../application/suggest.use-cases.js';
import { SuggestQuerySchema, SuggestResponseDto } from './dto.js';

/** Ô tìm của trang đặt chỗ (web OTA): gợi ý địa điểm, khách sạn, sân bay theo tên. Công khai, không cần đăng nhập. */
@ApiTags('discovery')
@Controller('suggest')
export class SuggestController {
  constructor(@Inject(SuggestUseCases) private readonly suggestions: SuggestUseCases) {}

  @Get()
  @ApiOperation({
    summary: 'Gợi ý địa điểm, khách sạn, sân bay khi gõ ở ô tìm trang đặt chỗ',
    description: [
      'Dùng cho web OTA (kiểu Traveloka), gọi sau mỗi lần ngừng gõ khoảng 250 ms. Công khai, không cần đăng nhập.',
      '',
      '- Tối đa 8 dòng lẫn loại: khoảng 3 địa điểm, 4 khách sạn, 1 sân bay; loại nào thiếu thì lấy thêm loại khác.',
      '- Khớp không dấu, gõ tắt (`pq`, `hcm`, `sg`), gõ sai nhẹ (`nha trag`, `da nng`). Khớp đầu từ xếp trước khớp gần đúng.',
      '- Câu ngắn hơn 4 ký tự (sau khi bỏ ký tự lạ) chỉ khớp đầu từ, không tìm gần đúng.',
      '- Không có giá, không kiểm còn phòng: chọn địa điểm thì gọi `/api/stays?placeId=<refId>` (chưa có), chọn khách sạn thì mở trang chi tiết.',
      '- Không khớp gì thì `items: []` (không phải lỗi).',
    ].join('\n'),
  })
  @ApiBadRequestResponse({ description: '`q` ngắn hơn 2 hoặc dài hơn 100 ký tự, hoặc `types` có loại lạ' })
  @ApiQuery({ name: 'q', example: 'da lat', description: 'Chữ người dùng gõ, có dấu hay không đều được (2–100 ký tự)' })
  @ApiQuery({ name: 'types', required: false, example: 'place,hotel', description: `Lọc loại: ${SUGGEST_TYPES.join(', ')}` })
  @ApiOkResponse({ type: SuggestResponseDto })
  async suggest(@Query() query: Record<string, unknown>): Promise<SuggestResponseDto> {
    const parsed = SuggestQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return { items: await this.suggestions.suggest(parsed.data) };
  }
}
