import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExploreUseCases } from '../application/explore.use-cases.js';
import { ExploreRequestDto, ExploreRequestSchema, ExploreResponseDto } from './dto.js';

/** Tìm khám phá của app (kiểu TikTok/Netflix): một ô tìm, kết quả chia theo vùng. Công khai. */
@ApiTags('discovery')
@Controller('search')
export class ExploreController {
  constructor(@Inject(ExploreUseCases) private readonly explore: ExploreUseCases) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tìm khám phá bằng câu tự nhiên, kết quả chia theo vùng (Ở đâu, Lộ trình, Bài viết, Video...)',
    description: [
      'Một ô tìm cho app. Công khai, không cần đăng nhập. Chỉ đọc chỉ mục của discovery (dựng lại mỗi 10 phút).',
      '',
      '- Hiểu nơi (`đà lạt`, `sg`), ý muốn (`ks`, `ăn gì`), ngân sách (`dưới 2tr`), số ngày (`3n2đ`), tên riêng, gõ sai nhẹ, không dấu.',
      '- Gõ có dấu thì tôn trọng dấu (`trứng` ≠ `Trung`). Không có gì khớp thì vùng có `total: 0`, không đoán bừa.',
      '- Vùng câu muốn tìm rỗng: `suggest` là các gợi ý khác (bỏ các từ trong `dropped`).',
      '- `loc` chỉ dùng khi câu không nói nơi.',
    ].join('\n'),
  })
  @ApiBody({ type: ExploreRequestDto })
  @ApiOkResponse({ type: ExploreResponseDto })
  @ApiBadRequestResponse({ description: '`q` rỗng hoặc dài hơn 200 ký tự, `loc` sai' })
  async search(@Body() body: unknown): Promise<ExploreResponseDto> {
    const parsed = ExploreRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Dữ liệu gửi lên không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return this.explore.search(parsed.data);
  }
}
