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
import { AccessFacade } from '../../../access/index.js';
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
import { ReviewQueueUseCase } from '../application/review-queue.use-case.js';
import { ReviewLeaseDto, ReviewLeaseSchema, ModerationCaseDto } from './dto.js';
import { AdminQueueQueryDto, AdminQueueQuerySchema } from './dto.js';
import { PostPartsScreeningUseCase } from '../application/post-parts-screening.use-case.js';
import { ModerationPartsDto, ModerationPartRetryDto } from './parts.dto.js';

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
    @Inject(ReviewQueueUseCase) private readonly review: ReviewQueueUseCase,
    @Inject(AccessFacade) private readonly access: AccessFacade,
    @Inject(PostPartsScreeningUseCase) private readonly parts: PostPartsScreeningUseCase,
  ) {}
  @Get('posts/:id/parts')
  @ApiOkResponse({ type: ModerationPartsDto })
  @ApiOperation({ summary: 'Bằng chứng quét riêng caption và từng ảnh của phiên bản bài hiện tại' })
  postParts(@Param('id', ParseUUIDPipe) id: string) {
    return this.parts.detail(id);
  }
  @Post('parts/:id/retry')
  @Idempotent()
  @ApiCreatedResponse({ type: ModerationPartRetryDto })
  retryPart(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.parts.retry(id, user.userId);
  }
  @Get('stats')
  @ApiOkResponse({ type: ModerationStatsDto })
  @ApiOperation({ summary: 'Số liệu tổng của hàng chờ, khiếu nại và scan, tính ở server' })
  stats(@CurrentUser() user: AuthUser) {
    return this.repository.stats(URGENT_SEVERITY, user.userId);
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
  async retryScan(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    if (await this.parts.exists(id)) {
      await this.parts.retry(id, user.userId);
      return { eventId: id, status: 'deferred' };
    }
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
  async queue(
    @Query(new ZodBody(AdminQueueQuerySchema)) input: AdminQueueQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const query = AdminQueueQuerySchema.parse(input);
    const page = await this.repository.queue({
      ...query,
      offset: query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0,
      actorId: user.userId,
    });
    return {
      ...page,
      nextCursor: page.nextCursor ?? null,
    };
  }
  @Get('queue/:id')
  @ApiOkResponse({ type: ModerationDetailDto })
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const item = await this.repository.findCase(id);
    if (!item) throw new NotFoundException('Không tìm thấy hồ sơ kiểm duyệt');
    await this.review.recordEvidenceView(id, user.userId);
    const detail = await this.repository.detail(item);
    const ids = [item.authorId, detail.postContext?.authorId, detail.parentComment?.authorId].filter(
      (id): id is string => !!id,
    );
    const contacts = await this.access.getUserContacts(ids);
    const author = (id: string) => {
      const contact = contacts.get(id);
      return contact ? { id, displayName: contact.displayName, email: contact.email } : null;
    };
    const assetId = detail.target?.coverMediaId;
    const playback = assetId ? await this.media.getPlayback([assetId]) : {};
    return {
      ...detail,
      author: author(item.authorId),
      postContext: detail.postContext
        ? { ...detail.postContext, author: author(detail.postContext.authorId) }
        : null,
      parentComment: detail.parentComment
        ? { ...detail.parentComment, author: author(detail.parentComment.authorId) }
        : null,
      target: detail.target
        ? { ...detail.target, coverUrl: assetId ? (playback[assetId]?.posters.w540 ?? null) : null }
        : null,
    };
  }
  @Post('queue/:id/lease')
  @ApiBody({ type: ReviewLeaseDto })
  @ApiCreatedResponse({ type: ModerationCaseDto })
  @Idempotent()
  reviewLease(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(ReviewLeaseSchema)) body: ReviewLeaseDto,
  ) {
    return this.review.execute(id, user.userId, body.action, body.leaseId);
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
