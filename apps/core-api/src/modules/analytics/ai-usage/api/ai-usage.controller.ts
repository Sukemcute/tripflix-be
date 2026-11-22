import { BadRequestException, Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { AiUsageUseCases } from '../application/ai-usage.use-cases.js';
import { AI_USAGE_GROUPS, type AiUsageGroup } from '../domain/ai-usage.js';

const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
// Ngày theo giờ Việt Nam: "2026-11-17" là 00:00 ngày 17 ở Việt Nam.
const startOfVnDay = (day: string) => new Date(`${day}T00:00:00+07:00`);
const vnToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export const AiUsageQuerySchema = z
  .object({
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
    groupBy: z.enum(AI_USAGE_GROUPS).default('feature'),
  })
  .transform((q, ctx) => {
    const to = q.to ?? vnToday(new Date());
    const end = new Date(startOfVnDay(to).getTime() + DAY_MS); // hết ngày `to`
    const start = q.from ? startOfVnDay(q.from) : new Date(end.getTime() - 7 * DAY_MS);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from phải là ngày có thật và không sau to' });
    } else if (end.getTime() - start.getTime() > MAX_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: `Tối đa ${MAX_DAYS} ngày` });
    }
    return { from: start, to: end, groupBy: q.groupBy as AiUsageGroup };
  });

class AiUsageRowDto {
  @ApiProperty({ example: 'cover_ocr', description: 'Tính năng, ngày YYYY-MM-DD hoặc tên model' }) key!: string;
  @ApiProperty({ example: 120 }) calls!: number;
  @ApiProperty({ example: 350000 }) inputTokens!: number;
  @ApiProperty({ example: 42000 }) outputTokens!: number;
  @ApiProperty({ example: 0.0132, description: 'USD, ước tính theo bảng giá ai-service' }) costUsd!: number;
  @ApiProperty({ example: 2, description: 'Lượt OCR không có token usage từ provider; chi phí thực chưa biết' }) unpricedCalls!: number;
}

class AiUsageTotalDto {
  @ApiProperty({ example: 120 }) calls!: number;
  @ApiProperty({ example: 350000 }) inputTokens!: number;
  @ApiProperty({ example: 42000 }) outputTokens!: number;
  @ApiProperty({ example: 0.0132 }) costUsd!: number;
  @ApiProperty({ example: 2 }) unpricedCalls!: number;
}

export class AiUsageResponseDto {
  @ApiProperty({ example: '2026-11-10T17:00:00.000Z', description: 'Đầu khoảng (gồm)' }) from!: string;
  @ApiProperty({ example: '2026-11-17T17:00:00.000Z', description: 'Cuối khoảng (không gồm)' }) to!: string;
  @ApiProperty({ enum: AI_USAGE_GROUPS }) groupBy!: AiUsageGroup;
  @ApiProperty({ type: [AiUsageRowDto] }) rows!: AiUsageRowDto[];
  @ApiProperty({ type: AiUsageTotalDto }) total!: AiUsageTotalDto;
}

/** Chi phí gọi AI (TF95) cho trang quản trị. Chỉ superadmin. */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles('superadmin')
export class AiUsageController {
  constructor(@Inject(AiUsageUseCases) private readonly usage: AiUsageUseCases) {}

  @Get('ai-usage')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Số lần gọi, token và chi phí AI theo tính năng, ngày hoặc model',
    description: 'Ngày theo giờ Việt Nam, gồm cả `from` và `to`. Mặc định 7 ngày tới hôm nay, tối đa 92 ngày. Chi phí là ước tính.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_GROUPS })
  @ApiOkResponse({ type: AiUsageResponseDto })
  @ApiBadRequestResponse({ description: 'Ngày sai dạng, from sau to, quá 92 ngày hoặc groupBy lạ' })
  async getAiUsage(@Query() query: Record<string, unknown>): Promise<AiUsageResponseDto> {
    const parsed = AiUsageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const report = await this.usage.report(parsed.data);
    return { from: parsed.data.from.toISOString(), to: parsed.data.to.toISOString(), groupBy: parsed.data.groupBy, ...report };
  }
}
