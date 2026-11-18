import { BadRequestException, Controller, Get, Header, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { AI_FEATURES } from '../../ai-usage/domain/ai-usage.js';
import { AiInsightsQueries, type AiTraceItem, type AiUserUsageItem } from '../application/ai-insights-queries.use-cases.js';
import { AI_BUCKETS, MAX_HOUR_BUCKET_DAYS, type AiBucket, type AiTimePoint, type AiTraceStep } from '../domain/ai-insights.js';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 92;
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
// Ngày theo giờ Việt Nam, như báo cáo chi phí AI: "2026-11-17" là 00:00 ngày 17 ở Việt Nam.
const startOfVnDay = (day: string) => new Date(`${day}T00:00:00+07:00`);
const vnToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

const WindowShape = { from: IsoDateSchema.optional(), to: IsoDateSchema.optional() };

function resolveWindow(q: { from?: string | undefined; to?: string | undefined }, ctx: z.RefinementCtx) {
  const to = q.to ?? vnToday(new Date());
  const end = new Date(startOfVnDay(to).getTime() + DAY_MS); // hết ngày `to`
  const start = q.from ? startOfVnDay(q.from) : new Date(end.getTime() - DEFAULT_DAYS * DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from phải là ngày có thật và không sau to' });
  } else if (end.getTime() - start.getTime() > MAX_DAYS * DAY_MS) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: `Tối đa ${MAX_DAYS} ngày` });
  }
  return { from: start, to: end };
}

const PageShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const TimeseriesQuerySchema = z
  .object({
    ...WindowShape,
    bucket: z.enum(AI_BUCKETS).default('day'),
    feature: z.enum(AI_FEATURES).optional(),
    model: z.string().min(1).max(100).optional(),
  })
  .transform((q, ctx) => {
    const window = resolveWindow(q, ctx);
    if (q.bucket === 'hour' && window.to.getTime() - window.from.getTime() > MAX_HOUR_BUCKET_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['bucket'], message: `Bucket giờ chỉ cho tối đa ${MAX_HOUR_BUCKET_DAYS} ngày` });
    }
    return { ...window, bucket: q.bucket as AiBucket, feature: q.feature, model: q.model };
  });

export const UsersQuerySchema = z
  .object({ ...WindowShape, ...PageShape, userId: z.uuid().optional() })
  .transform((q, ctx) => ({ ...resolveWindow(q, ctx), page: q.page, pageSize: q.pageSize, userId: q.userId }));

export const TracesQuerySchema = z
  .object({
    ...WindowShape,
    ...PageShape,
    userId: z.uuid().optional(),
    answerKind: z.string().min(1).max(30).optional(),
    minCostUsd: z.coerce.number().min(0).optional(),
  })
  .transform((q, ctx) => ({
    ...resolveWindow(q, ctx),
    page: q.page,
    pageSize: q.pageSize,
    userId: q.userId,
    answerKind: q.answerKind,
    minCostUsd: q.minCostUsd,
  }));

class AiTimeseriesPointDto {
  @ApiProperty({ example: '2026-11-17T17:00:00.000Z', description: 'Đầu bucket (theo giờ Việt Nam)' }) at!: string;
  @ApiProperty({ example: 120 }) calls!: number;
  @ApiProperty({ example: 350000 }) inputTokens!: number;
  @ApiProperty({ example: 42000 }) outputTokens!: number;
  @ApiProperty({ example: 0.0132, description: 'USD, ước tính theo bảng giá ai-service' }) costUsd!: number;
}

export class AiTimeseriesResponseDto {
  @ApiProperty({ example: '2026-11-10T17:00:00.000Z' }) from!: string;
  @ApiProperty({ example: '2026-11-17T17:00:00.000Z' }) to!: string;
  @ApiProperty({ enum: AI_BUCKETS }) bucket!: AiBucket;
  @ApiProperty({ type: [AiTimeseriesPointDto], description: 'Bucket không có dữ liệu được điền 0' }) points!: AiTimeseriesPointDto[];
}

class AiContactDto {
  @ApiProperty({ type: String, nullable: true, description: 'Null khi tài khoản không còn' }) displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Email đăng ký; null khi tài khoản không còn' }) email!: string | null;
}

class AiUserUsageItemDto extends AiContactDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: 30, description: 'Số lần gọi LLM' }) calls!: number;
  @ApiProperty({ example: 4, description: 'Số cuộc trò chuyện' }) conversations!: number;
  @ApiProperty({ example: 52000 }) inputTokens!: number;
  @ApiProperty({ example: 6000 }) outputTokens!: number;
  @ApiProperty({ example: 0.0042 }) costUsd!: number;
  @ApiProperty({ example: '2026-11-18T10:20:00.000Z' }) lastAt!: string;
}

export class AiUserUsageResponseDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) pageSize!: number;
  @ApiProperty({ example: 12, description: 'Số người dùng có lượt gọi AI trong khoảng' }) total!: number;
  @ApiProperty({ type: [AiUserUsageItemDto], description: 'Tốn nhiều nhất trước' }) items!: AiUserUsageItemDto[];
}

class AiTraceItemDto extends AiContactDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Null với lượt chat cũ chưa có turnId: không mở được chi tiết' }) turnId!: string | null;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: '2026-11-18T10:20:00.000Z' }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Câu hỏi đã che email, số điện thoại, cắt 120 ký tự' }) question!: string | null;
  @ApiProperty({ type: String, nullable: true }) intent!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'answer', description: 'answer, clarify, refusal, no_result, fallback hoặc error' }) answerKind!: string | null;
  @ApiProperty({ description: 'Người dùng bấm nút trên thẻ, không gọi LLM' }) isAction!: boolean;
  @ApiProperty({ type: Number, nullable: true, example: 1800, description: 'Thời gian xử lý cả lượt (ms)' }) latencyMs!: number | null;
  @ApiProperty({ example: 2, description: 'Số bước gọi LLM đã nối được' }) steps!: number;
  @ApiProperty({ example: 2400 }) inputTokens!: number;
  @ApiProperty({ example: 300 }) outputTokens!: number;
  @ApiProperty({ example: 0.0004 }) costUsd!: number;
}

export class AiTraceListResponseDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) pageSize!: number;
  @ApiProperty({ example: 57 }) total!: number;
  @ApiProperty({ type: [AiTraceItemDto], description: 'Mới nhất trước' }) items!: AiTraceItemDto[];
}

class AiTraceStepDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'controller', description: 'controller, responder; null với tóm tắt và kiểm duyệt' }) step!: string | null;
  @ApiProperty({ example: 'gpt-5-mini' }) model!: string;
  @ApiProperty({ type: Number, nullable: true }) inputTokens!: number | null;
  @ApiProperty({ type: Number, nullable: true }) outputTokens!: number | null;
  @ApiProperty({ example: 0.0002 }) costUsd!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Thời gian một lần gọi LLM (ms); null với sự kiện chưa có' }) latencyMs!: number | null;
  @ApiProperty({ example: '2026-11-18T10:20:01.000Z' }) occurredAt!: string;
  @ApiProperty({ description: 'Chi phí ước tính theo bảng giá, không phải hoá đơn' }) isEstimated!: boolean;
}

export class AiTraceDetailResponseDto {
  @ApiProperty({ type: AiTraceItemDto }) trace!: AiTraceItemDto;
  @ApiProperty({ type: [AiTraceStepDto], description: 'Các bước gọi LLM của lượt này, theo thứ tự thời gian' }) steps!: AiTraceStepDto[];
}

const toPointDto = (point: AiTimePoint): AiTimeseriesPointDto => ({ ...point, at: point.at.toISOString() });
const toUserDto = (item: AiUserUsageItem): AiUserUsageItemDto => ({ ...item, lastAt: item.lastAt.toISOString() });
const toTraceDto = (item: AiTraceItem): AiTraceItemDto => ({ ...item, occurredAt: item.occurredAt.toISOString() });
const toStepDto = (step: AiTraceStep): AiTraceStepDto => ({ ...step, occurredAt: step.occurredAt.toISOString() });

function parse<T>(schema: z.ZodType<T>, query: Record<string, unknown>): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Tham số không hợp lệ',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bảng điều khiển chi phí AI và trace từng lượt chat (SCRUM-179). Chỉ superadmin: có tên, email và câu hỏi chat. */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@Roles('superadmin')
export class AiInsightsController {
  constructor(@Inject(AiInsightsQueries) private readonly insights: AiInsightsQueries) {}

  @Get('ai-usage/timeseries')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Lưu lượng AI theo thời gian: lần gọi, token, chi phí theo giờ hoặc ngày',
    description: `Ngày theo giờ Việt Nam, gồm cả from và to. Mặc định 7 ngày, tối đa ${MAX_DAYS} ngày. Bucket giờ chỉ cho tối đa ${MAX_HOUR_BUCKET_DAYS} ngày.`,
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiQuery({ name: 'bucket', required: false, enum: AI_BUCKETS })
  @ApiQuery({ name: 'feature', required: false, enum: AI_FEATURES })
  @ApiQuery({ name: 'model', required: false, type: String })
  @ApiOkResponse({ type: AiTimeseriesResponseDto })
  @ApiBadRequestResponse({ description: 'Ngày sai dạng, from sau to, quá 92 ngày, bucket giờ quá 8 ngày hoặc tham số lạ' })
  async timeseries(@Query() query: Record<string, unknown>): Promise<AiTimeseriesResponseDto> {
    const parsed = parse(TimeseriesQuerySchema, query);
    const points = await this.insights.timeseries(parsed);
    return { from: parsed.from.toISOString(), to: parsed.to.toISOString(), bucket: parsed.bucket, points: points.map(toPointDto) };
  }

  @Get('ai-usage/users')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Người dùng xếp theo chi phí AI: lần gọi, cuộc trò chuyện, token, chi phí, kèm tên và email',
    description: 'Chỉ tính lượt gọi đã gắn với người dùng (chat của người đã đăng nhập, từ bản ai-service mới). Truyền userId để xem một người.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiOkResponse({ type: AiUserUsageResponseDto })
  @ApiBadRequestResponse({ description: 'Ngày sai dạng, quá 92 ngày, phân trang lạ hoặc userId không phải UUID' })
  async users(@Query() query: Record<string, unknown>): Promise<AiUserUsageResponseDto> {
    const parsed = parse(UsersQuerySchema, query);
    const { items, total } = await this.insights.users(parsed);
    return {
      from: parsed.from.toISOString(),
      to: parsed.to.toISOString(),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      items: items.map(toUserDto),
    };
  }

  @Get('ai-traces')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Danh sách lượt chat Tripi: câu hỏi đã che, kết quả, thời gian, token và chi phí',
    description: 'Lọc theo người dùng, kết quả (answerKind) và chi phí tối thiểu. Lượt chat cũ chưa có turnId vẫn hiện nhưng token bằng 0.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'answerKind', required: false, type: String, example: 'error' })
  @ApiQuery({ name: 'minCostUsd', required: false, type: Number, example: 0.001 })
  @ApiOkResponse({ type: AiTraceListResponseDto })
  @ApiBadRequestResponse({ description: 'Tham số không hợp lệ' })
  async traces(@Query() query: Record<string, unknown>): Promise<AiTraceListResponseDto> {
    const parsed = parse(TracesQuerySchema, query);
    const { items, total } = await this.insights.traces(parsed);
    return {
      from: parsed.from.toISOString(),
      to: parsed.to.toISOString(),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      items: items.map(toTraceDto),
    };
  }

  @Get('ai-traces/:turnId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Chi tiết một lượt chat: các bước gọi LLM với model, token, chi phí, thời gian' })
  @ApiOkResponse({ type: AiTraceDetailResponseDto })
  @ApiBadRequestResponse({ description: 'turnId không phải UUID' })
  @ApiNotFoundResponse({ description: 'Không có lượt chat nào với turnId này' })
  async trace(@Param('turnId') turnId: string): Promise<AiTraceDetailResponseDto> {
    if (!TURN_ID.test(turnId)) throw new BadRequestException('turnId phải là UUID');
    const found = await this.insights.trace(turnId);
    if (!found) throw new NotFoundException('Không có lượt chat này');
    return { trace: toTraceDto(found.trace), steps: found.steps.map(toStepDto) };
  }
}
