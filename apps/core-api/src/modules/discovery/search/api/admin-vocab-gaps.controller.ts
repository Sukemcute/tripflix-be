import { BadRequestException, Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { ExploreUseCases, QUERY_GRAMS_RETENTION_DAYS } from '../application/explore.use-cases.js';

export const VocabGapsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(QUERY_GRAMS_RETENTION_DAYS).default(7),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  minCount: z.coerce.number().int().min(1).max(1_000).default(3),
});

class VocabGapVariantDto {
  @ApiProperty({ example: 'ha loii' }) gram!: string;
  @ApiProperty({ example: 4, description: 'Số câu tìm có kiểu viết này' }) queryHits!: number;
}

class VocabGapDto {
  @ApiProperty({ example: 'ha loi', description: 'N-gram đã bỏ dấu, viết thường; kiểu viết có điểm cao nhất của nhóm' }) gram!: string;
  @ApiProperty({ enum: [1, 2], description: 'Số từ' }) n!: number;
  @ApiProperty({ example: 61.2, description: 'G² (log-likelihood): càng cao càng chắc người tìm dùng nhiều hơn nội dung' }) score!: number;
  @ApiProperty({ example: 21, description: 'Tổng số câu tìm của cả nhóm' }) queryHits!: number;
  @ApiProperty({ example: 0, description: 'Số lần `gram` xuất hiện trong nội dung đã đánh chỉ mục' }) contentCount!: number;
  @ApiProperty({ type: [VocabGapVariantDto], description: 'Các kiểu viết gần nhau đã gom (gồm cả `gram`), nhiều điểm nhất trước' })
  variants!: VocabGapVariantDto[];
  @ApiProperty({ type: [String], example: ['hà lội ăn gì', 'homestay hà lội'], description: 'Tối đa 5 câu tìm gốc' }) samples!: string[];
}

class VocabGapsDto {
  @ApiProperty({ example: 7 }) days!: number;
  @ApiProperty({ example: 1342, description: 'Số câu tìm đã đếm trong khoảng ngày' }) queries!: number;
  @ApiProperty({ type: [VocabGapDto], description: 'Điểm cao nhất trước' }) items!: VocabGapDto[];
}

/** Admin xem người dùng tìm bằng từ nào mà nội dung không dùng, để quyết định thêm gì vào từ điển tìm kiếm. */
@ApiTags('Admin Search Vocab Gaps')
@ApiBearerAuth()
@Roles('moderator', 'superadmin')
@Controller('v1/admin/search/vocab-gaps')
export class AdminVocabGapsController {
  constructor(@Inject(ExploreUseCases) private readonly explore: ExploreUseCases) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Khoảng trống từ vựng: n-gram người tìm dùng nhiều hơn hẳn nội dung',
    description: [
      'So log câu tìm (tìm khám phá + trang đầu tìm bài, không lưu người tìm) với chỉ mục nội dung bằng log-likelihood ratio G².',
      'Không gồm ngân sách, số ngày, từ dừng, nơi đã hiểu, và n-gram mà mọi từ đều đã khớp từ điển.',
      'Kiểu viết gần nhau (cách 1–2 chữ, đã bỏ dấu) gom một nhóm. Ngày tính theo UTC.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'days', required: false, type: Number, description: `1–${QUERY_GRAMS_RETENTION_DAYS}, mặc định 7` })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–200, mặc định 50' })
  @ApiQuery({ name: 'minCount', required: false, type: Number, description: 'Bỏ n-gram có ít câu tìm hơn; 1–1000, mặc định 3' })
  @ApiOkResponse({ type: VocabGapsDto })
  @ApiBadRequestResponse({ description: 'Tham số ngoài khoảng' })
  async list(@Query() query: unknown): Promise<VocabGapsDto> {
    const parsed = VocabGapsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return this.explore.vocabGaps(parsed.data);
  }
}
