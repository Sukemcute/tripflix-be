import { BadRequestException, Controller, Get, Header, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { UserActivityQueries } from '../application/user-activity-queries.use-cases.js';
import { DAY_MS, USER_ACTIVITY_RETENTION_DAYS } from '../domain/user-activity.js';

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
  @ApiOkResponse({ description: 'items gồm userId, displayName, email, số lượt từng loại, lastActiveAt; kèm total' })
  @ApiBadRequestResponse({ description: 'Ngày sai dạng, from sau to, quá 90 ngày hoặc phân trang lạ' })
  async list(@Query() query: Record<string, unknown>) {
    const parsed = UserActivityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const { items, total } = await this.activity.list(parsed.data);
    return {
      from: parsed.data.from.toISOString(),
      to: parsed.data.to.toISOString(),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total,
      items,
    };
  }

  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Chi tiết hành vi một người dùng: tên, email đăng ký, số lượt trong khoảng và 50 sự kiện gần nhất',
  })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-11' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-17' })
  @ApiOkResponse({ description: 'Hồ sơ hành vi của người dùng' })
  @ApiNotFoundResponse({ description: 'Không có tài khoản với userId này' })
  async detail(@Param('userId') userId: string, @Query() query: Record<string, unknown>) {
    if (!USER_ID.test(userId)) throw new BadRequestException('userId phải là UUID');
    const parsed = UserActivityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Tham số không hợp lệ',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const detail = await this.activity.detail(userId, parsed.data);
    if (!detail) throw new NotFoundException('Không có người dùng này');
    return {
      ...detail,
      from: parsed.data.from.toISOString(),
      to: parsed.data.to.toISOString(),
    };
  }
}
