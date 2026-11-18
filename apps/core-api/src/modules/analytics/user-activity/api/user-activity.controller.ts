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
import { UserActivityQueries } from '../application/user-activity-queries.use-cases.js';
import type { UserActivityEventRow } from '../application/user-activity.use-cases.js';
import { DAY_MS, USER_ACTIVITY_KINDS, USER_ACTIVITY_RETENTION_DAYS, type UserActivityCounts } from '../domain/user-activity.js';

const DEFAULT_DAYS = 7;
const MAX_DAYS = USER_ACTIVITY_RETENTION_DAYS;
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
// Ngày theo giờ Việt Nam, như báo cáo AI: "2026-11-17" là 00:00 ngày 17 ở Việt Nam.
const startOfVnDay = (day: string) => new Date(`${day}T00:00:00+07:00`);
const vnToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export const UserActivityQuerySchema = z
  .object({
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .transform((q, ctx) => {
    const to = q.to ?? vnToday(new Date());
    const end = new Date(startOfVnDay(to).getTime() + DAY_MS); // hết ngày `to`
    const start = q.from ? startOfVnDay(q.from) : new Date(end.getTime() - DEFAULT_DAYS * DAY_MS);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from phải là ngày có thật và không sau to' });
    } else if (end.getTime() - start.getTime() > MAX_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: `Tối đa ${MAX_DAYS} ngày` });
    }
    return { from: start, to: end, page: q.page, pageSize: q.pageSize };
  });

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UserActivityCountsDto {
  @ApiProperty({ example: 12, description: 'Lượt thích (đặt hoặc đổi cảm xúc)' }) reactions!: number;
  @ApiProperty({ example: 3 }) comments!: number;
  @ApiProperty({ example: 2 }) shares!: number;
  @ApiProperty({ example: 40, description: 'Lượt xem đủ điều kiện' }) views!: number;
  @ApiProperty({ example: 5, description: 'Lượt chat với Tripi' }) chats!: number;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-18T10:20:00.000Z' }) lastActiveAt!: string | null;
}

class UserActivityListItemDto extends UserActivityCountsDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null khi tài khoản không còn' }) displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Email đăng ký; null khi tài khoản không còn' }) email!: string | null;
}

export class UserActivityListResponseDto {
  @ApiProperty({ example: '2026-11-11T17:00:00.000Z', description: 'Đầu khoảng (gồm)' }) from!: string;
  @ApiProperty({ example: '2026-11-18T17:00:00.000Z', description: 'Cuối khoảng (không gồm)' }) to!: string;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) pageSize!: number;
  @ApiProperty({ example: 57, description: 'Số người có hoạt động trong khoảng' }) total!: number;
  @ApiProperty({ type: [UserActivityListItemDto] }) items!: UserActivityListItemDto[];
}

class UserActivityEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: USER_ACTIVITY_KINDS }) kind!: string;
  @ApiProperty({ example: '2026-11-18T10:20:00.000Z' }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Bài viết liên quan; null với lượt chat' }) targetId!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Chat: question, intent, answerKind, isAction, conversationId. Thích: reaction. Xem: watchedMs, surface.',
  })
  detail!: Record<string, unknown>;
}

export class UserActivityDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ description: 'Email đăng ký' }) email!: string;
  @ApiProperty({ example: '2026-10-01T03:00:00.000Z', description: 'Ngày đăng ký' }) createdAt!: string;
  @ApiProperty({ type: UserActivityCountsDto }) counts!: UserActivityCountsDto;
  @ApiProperty({ type: [UserActivityEventDto], description: '50 sự kiện gần nhất trong khoảng' }) recentEvents!: UserActivityEventDto[];
  @ApiProperty({ example: '2026-11-11T17:00:00.000Z' }) from!: string;
  @ApiProperty({ example: '2026-11-18T17:00:00.000Z' }) to!: string;
}

const toCountsDto = (counts: UserActivityCounts): UserActivityCountsDto => ({
  ...counts,
  lastActiveAt: counts.lastActiveAt ? counts.lastActiveAt.toISOString() : null,
});

const toEventDto = (event: UserActivityEventRow): UserActivityEventDto => ({
  ...event,
  occurredAt: event.occurredAt.toISOString(),
});

/** Hành vi từng người dùng (TF177) cho trang quản trị. Chỉ superadmin: có email và câu hỏi chat. */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics/user-activity')
@Roles('superadmin')
export class UserActivityController {
  constructor(@Inject(UserActivityQueries) private readonly activity: UserActivityQueries) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Danh sách người dùng có hoạt động trong khoảng, kèm số lượt thích, bình luận, chia sẻ, xem, chat',
    description: 'Ngày theo giờ Việt Nam, gồm cả from và to. Mặc định 7 ngày tới hôm nay, tối đa 90 ngày. Sắp theo hoạt động gần nhất.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: UserActivityListResponseDto })
  @ApiBadRequestResponse({ description: 'Ngày sai dạng, from sau to, quá 90 ngày hoặc phân trang lạ' })
  async list(@Query() query: Record<string, unknown>): Promise<UserActivityListResponseDto> {
    const parsed = parseQuery(query);
    const { items, total } = await this.activity.list(parsed);
    return {
      from: parsed.from.toISOString(),
      to: parsed.to.toISOString(),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      items: items.map((item) => ({ ...item, ...toCountsDto(item) })),
    };
  }

  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Chi tiết hành vi một người dùng: tên, email đăng ký, số lượt trong khoảng và 50 sự kiện gần nhất',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiOkResponse({ type: UserActivityDetailResponseDto })
  @ApiBadRequestResponse({ description: 'userId không phải UUID hoặc ngày sai' })
  @ApiNotFoundResponse({ description: 'Không có tài khoản với userId này' })
  async detail(@Param('userId') userId: string, @Query() query: Record<string, unknown>): Promise<UserActivityDetailResponseDto> {
    if (!USER_ID.test(userId)) throw new BadRequestException('userId phải là UUID');
    const parsed = parseQuery(query);
    const detail = await this.activity.detail(userId, parsed);
    if (!detail) throw new NotFoundException('Không có người dùng này');
    return {
      userId: detail.userId,
      displayName: detail.displayName,
      email: detail.email,
      createdAt: detail.createdAt.toISOString(),
      counts: toCountsDto(detail.counts),
      recentEvents: detail.recentEvents.map(toEventDto),
      from: parsed.from.toISOString(),
      to: parsed.to.toISOString(),
    };
  }
}

function parseQuery(query: Record<string, unknown>) {
  const parsed = UserActivityQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Tham số không hợp lệ',
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}
