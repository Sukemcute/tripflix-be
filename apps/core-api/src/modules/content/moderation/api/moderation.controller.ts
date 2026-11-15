import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import { Idempotent } from '@tripflix/idempotency';
import { MediaFacade } from '../../media/media.facade.js';
import { ZodBody } from '../../social/api/http.js';
import {
  DecideAppealUseCase,
  DecideCaseUseCase,
  SubmitAppealUseCase,
  SubmitReportUseCase,
} from '../application/moderation.use-cases.js';
import { z } from 'zod';
import { ChangeVisibilityUseCase } from '../application/change-visibility.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { ClaimDeferredScansUseCase } from '../application/recover-screening.use-case.js';
import {
  DecisionDto,
  DecisionSchema,
  LogQueryDto,
  LogQuerySchema,
  QueueQueryDto,
  QueueQuerySchema,
  ReportDto,
  ReportSchema,
} from './dto.js';
import {
  ModerationDecisionResultDto,
  ModerationDetailDto,
  ModerationLogPageDto,
  ModerationQueuePageDto,
  ModerationReportDto,
  SubmitAppealDto,
  AppealOutcomeDto,
  AppealDto,
  AppealPageDto,
  AppealQueuePageDto,
  MyDecisionPageDto,
  MyReportPageDto,
  FailedScanPageDto,
  ModerationStatsDto,
  ScanRetryDto,
} from './dto.js';
import { URGENT_SEVERITY } from '../domain/severity.js';

@ApiTags('Moderation - Reports')
@ApiBearerAuth()
@Controller('v1')
@Authenticated()
export class ReportsController {
  constructor(
    @Inject(SubmitReportUseCase) private readonly submit: SubmitReportUseCase,
    @Inject(ModerationRepository) private readonly repository: ModerationRepository,
    @Inject(SubmitAppealUseCase) private readonly appeal: SubmitAppealUseCase,
  ) {}
  @Post('moderation/decisions/:id/appeals')
  @ApiBody({ type: SubmitAppealDto })
  @ApiCreatedResponse({ type: AppealDto })
  @Idempotent()
  submitAppeal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(z.object({ reason: z.string().trim().min(1).max(1000) }))) body: { reason: string },
  ) {
    return this.appeal.execute(id, user.userId, body.reason.trim());
  }
  @Get('me/reports')
  @ApiOkResponse({ type: MyReportPageDto })
  @ApiOperation({ summary: 'Trạng thái các báo cáo của tôi' })
  async myReports(@CurrentUser() user: AuthUser, @Query(new ZodBody(QueueQuerySchema)) raw: QueueQueryDto) {
    const { limit, cursor } = QueueQuerySchema.parse(raw);
    const rows = await this.repository.reportsByUser(user.userId, limit, cursor);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null };
  }
  @Get('me/moderation/appeals')
  @ApiOkResponse({ type: AppealPageDto })
  async myAppeals(@CurrentUser() user: AuthUser, @Query(new ZodBody(QueueQuerySchema)) raw: QueueQueryDto) {
    const { limit, cursor } = QueueQuerySchema.parse(raw);
    const rows = await this.repository.appealsByUser(user.userId, limit, cursor);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null };
  }
  @Get('me/moderation/decisions')
  @ApiOkResponse({ type: MyDecisionPageDto })
  async myDecisions(@CurrentUser() user: AuthUser, @Query(new ZodBody(QueueQuerySchema)) raw: QueueQueryDto) {
    const { limit, cursor } = QueueQuerySchema.parse(raw);
    const rows = await this.repository.decisionsByUser(user.userId, limit, cursor);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null };
  }
  @Post('posts/:id/reports')
  @ApiCreatedResponse({ type: ModerationReportDto })
  @Idempotent()
  @ApiBody({ type: ReportDto })
  reportPost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(ReportSchema)) body: ReportDto,
  ) {
    return this.submit.execute({
      ...ReportSchema.parse(body),
      targetType: 'post',
      targetId: id,
      reporterId: user.userId,
    });
  }
  @Post('comments/:id/reports')
  @ApiCreatedResponse({ type: ModerationReportDto })
  @Idempotent()
  @ApiBody({ type: ReportDto })
  reportComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(ReportSchema)) body: ReportDto,
  ) {
    return this.submit.execute({
      ...ReportSchema.parse(body),
      targetType: 'comment',
      targetId: id,
      reporterId: user.userId,
    });
  }
}

@ApiTags('Moderation - Admin')
@ApiBearerAuth()
@Controller('v1/admin/moderation')
@Roles('moderator', 'superadmin')
export class AdminModerationController {
  constructor(
    @Inject(ModerationRepository) private readonly repository: ModerationRepository,
    @Inject(DecideCaseUseCase) private readonly decide: DecideCaseUseCase,
    @Inject(ChangeVisibilityUseCase) private readonly visibility: ChangeVisibilityUseCase,
    @Inject(MediaFacade) private readonly media: MediaFacade,
    @Inject(DecideAppealUseCase) private readonly decideAppeal: DecideAppealUseCase,
    @Inject(ClaimDeferredScansUseCase) private readonly recovery: ClaimDeferredScansUseCase,
  ) {}
  @Get('stats')
  @ApiOkResponse({ type: ModerationStatsDto })
  @ApiOperation({ summary: 'Số liệu tổng của hàng chờ, khiếu nại và scan, tính ở server' })
  stats() {
    return this.repository.stats(URGENT_SEVERITY);
  }
  @Get('scans/failed')
  @ApiOkResponse({ type: FailedScanPageDto })
  async failedScans(@Query(new ZodBody(QueueQuerySchema)) raw: QueueQueryDto) {
    const { limit, cursor } = QueueQuerySchema.parse(raw);
    const rows = await this.repository.failedScans(limit, cursor);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null };
  }
  @Post('scans/:id/retry')
  @ApiCreatedResponse({ type: ScanRetryDto })
  @Idempotent()
  retryScan(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recovery.retry(id, user.userId);
  }
  @Get('appeals')
  @ApiOkResponse({ type: AppealQueuePageDto })
  async appeals(@Query(new ZodBody(QueueQuerySchema)) raw: QueueQueryDto) {
    const { limit, cursor } = QueueQuerySchema.parse(raw);
    const rows = await this.repository.pendingAppeals(limit, cursor);
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null };
  }
  @Post('appeals/:id/decisions')
  @ApiBody({ type: AppealOutcomeDto })
  @ApiCreatedResponse({ type: AppealDto })
  @Idempotent()
  appealDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(z.object({ outcome: z.enum(['upheld', 'overturned']) })))
    body: { outcome: 'upheld' | 'overturned' },
  ) {
    return this.decideAppeal.execute(id, user.userId, body.outcome);
  }
  @Get('queue')
  @ApiOkResponse({ type: ModerationQueuePageDto })
  @ApiOperation({ summary: 'Hàng chờ kiểm duyệt theo mức ưu tiên' })
  async queue(@Query(new ZodBody(QueueQuerySchema)) input: QueueQueryDto) {
    const query = QueueQuerySchema.parse(input);
    const page = await this.repository.queue({ ...query, offset: query.cursor });
    return {
      ...page,
      nextCursor:
        query.cursor + page.items.length < page.total ? String(query.cursor + page.items.length) : null,
    };
  }
  @Get('queue/:id')
  @ApiOkResponse({ type: ModerationDetailDto })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const item = await this.repository.findCase(id);
    if (!item) throw new NotFoundException('Không tìm thấy hồ sơ kiểm duyệt');
    const detail = await this.repository.detail(item);
    const assetId = detail.target?.coverMediaId;
    const playback = assetId ? await this.media.getPlayback([assetId]) : {};
    return {
      ...detail,
      target: detail.target
        ? { ...detail.target, coverUrl: assetId ? (playback[assetId]?.posters.w540 ?? null) : null }
        : null,
    };
  }
  @Post('queue/:id/decisions')
  @ApiCreatedResponse({ type: ModerationDecisionResultDto })
  @Idempotent()
  @ApiBody({ type: DecisionDto })
  decision(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(DecisionSchema)) body: DecisionDto,
  ) {
    return this.decide.execute(id, {
      ...DecisionSchema.parse(body),
      actorId: user.userId,
      actorIsSuperAdmin: user.role === 'superadmin',
    });
  }
  @Post('comments/:id/actions')
  @ApiCreatedResponse({ type: ModerationDecisionResultDto })
  @Idempotent()
  @ApiOperation({ summary: 'Ẩn, khôi phục hoặc xoá bình luận ngoài hồ sơ đã đóng' })
  @ApiBody({ type: DecisionDto })
  commentAction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(DecisionSchema)) body: DecisionDto,
  ) {
    return this.visibility.execute({
      ...DecisionSchema.parse(body),
      targetType: 'comment',
      targetId: id,
      actorId: user.userId,
      actorIsSuperAdmin: user.role === 'superadmin',
      actorType: 'staff',
    });
  }
  @Get('actions')
  @ApiOkResponse({ type: ModerationLogPageDto })
  async actions(@Query(new ZodBody(LogQuerySchema)) raw: LogQueryDto) {
    const query = LogQuerySchema.parse(raw);
    const items = await this.repository.log({
      actorId: query.moderatorId,
      targetId: query.targetId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit + 1,
      offset: query.cursor,
    });
    return {
      items: items.slice(0, query.limit),
      nextCursor: items.length > query.limit ? String(query.cursor + query.limit) : null,
    };
  }
}
