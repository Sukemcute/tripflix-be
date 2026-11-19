import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { REASON_CODES } from '../domain/reason-codes.js';
export const ReportSchema = z.object({
  reasonCode: z.enum(REASON_CODES),
  reasonDetail: z.string().trim().max(500).optional(),
});
export const DecisionSchema = ReportSchema.extend({
  leaseId: z.uuid().optional(),
  action: z.enum(['hide', 'restore', 'remove', 'dismiss']),
});
export class ReportDto {
  @ApiProperty({ enum: REASON_CODES }) reasonCode!: (typeof REASON_CODES)[number];
  @ApiPropertyOptional({ maxLength: 500 }) reasonDetail?: string;
}
export class DecisionDto extends ReportDto {
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string;
  @ApiProperty({ enum: ['hide', 'restore', 'remove', 'dismiss'] }) action!:
    'hide' | 'restore' | 'remove' | 'dismiss';
}
export const QueueQuerySchema = z.object({
  status: z.enum(['pending', 'resolved']).optional(),
  view: z.enum(['pending', 'reviewed', 'hidden', 'removed']).optional(),
  targetType: z.enum(['post', 'comment']).optional(),
  source: z.enum(['rule', 'ai', 'report', 'new_content']).optional(),
  reasonCode: z.enum(REASON_CODES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
});
export class QueueQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'resolved'] }) status?: 'pending' | 'resolved';
  @ApiPropertyOptional({ enum: ['pending', 'reviewed', 'hidden', 'removed'] })
  view?: 'pending' | 'reviewed' | 'hidden' | 'removed';
  @ApiPropertyOptional({ enum: ['post', 'comment'] }) targetType?: 'post' | 'comment';
  @ApiPropertyOptional({ enum: ['rule', 'ai', 'report', 'new_content'] }) source?: string;
  @ApiPropertyOptional({ enum: REASON_CODES }) reasonCode?: string;
  @ApiPropertyOptional({ default: 20 }) limit?: number;
  @ApiPropertyOptional({ description: 'Vị trí bắt đầu trang, lấy từ nextCursor' }) cursor?: string;
}
export const AdminQueueQuerySchema = QueueQuerySchema.extend({
  cursor: z.string().max(1024).optional(),
  assignment: z.enum(['all', 'unassigned', 'mine']).optional(),
  sla: z.enum(['all', 'overdue', 'due_soon']).optional(),
  search: z.string().trim().max(160).optional(),
});
export class AdminQueueQueryDto extends QueueQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'unassigned', 'mine'] }) assignment?: 'all' | 'unassigned' | 'mine';
  @ApiPropertyOptional({ enum: ['all', 'overdue', 'due_soon'] }) sla?: 'all' | 'overdue' | 'due_soon';
  @ApiPropertyOptional({ maxLength: 160 }) search?: string;
}
export const LogQuerySchema = z.object({
  moderatorId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
});
export class LogQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) moderatorId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) targetId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) to?: string;
  @ApiPropertyOptional({ default: 20 }) limit?: number;
  @ApiPropertyOptional() cursor?: string;
}

export class ModerationCaseDto {
  @ApiProperty({ type: String, nullable: true }) assigneeId!: string | null;
  @ApiProperty({ type: String, nullable: true }) leaseId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) leaseExpiresAt!: string | null;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['post', 'comment'] }) targetType!: 'post' | 'comment';
  @ApiProperty() targetId!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ enum: ['pending', 'resolved'] }) status!: 'pending' | 'resolved';
  @ApiProperty({ type: [String] }) sources!: string[];
  @ApiProperty() severity!: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) flags!: Record<string, unknown>;
  @ApiProperty() reportCount!: number;
  @ApiProperty() isAutoHidden!: boolean;
  @ApiProperty({ type: String, nullable: true }) resolution!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Text preview returned in the queue.' })
  targetPreview?: string | null;
}
export class ModerationQueuePageDto {
  @ApiProperty({ type: [ModerationCaseDto] }) items!: ModerationCaseDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class ModerationTargetDto {
  @ApiPropertyOptional({ type: String, nullable: true }) coverUrl?: string | null;
  @ApiProperty() text!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) coverMediaId!: string | null;
}
export class ModerationLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() targetType!: string;
  @ApiProperty({ type: String, nullable: true }) postId!: string | null;
  @ApiProperty({ type: String, nullable: true }) commentId!: string | null;
  @ApiProperty() moderatorId!: string;
  @ApiProperty() actorType!: string;
  @ApiProperty() action!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ type: String, nullable: true }) reasonDetail!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) contentVersion!: string | null;
  @ApiProperty({ type: String, nullable: true }) policyVersion!: string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) evidenceSnapshot!: Record<
    string,
    unknown
  > | null;
}
export class ModerationReportDto {
  @ApiProperty() id!: string;
  @ApiProperty() reporterId!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ type: String, nullable: true }) reasonDetail!: string | null;
  @ApiProperty() createdAt!: string;
}
export class ReviewLeaseDto {
  @ApiProperty({ enum: ['claim', 'renew', 'release'] }) action!: 'claim' | 'renew' | 'release';
  @ApiPropertyOptional({ format: 'uuid' }) leaseId?: string;
}
export const ReviewLeaseSchema = z
  .object({ action: z.enum(['claim', 'renew', 'release']), leaseId: z.uuid().optional() })
  .refine((value) => value.action === 'claim' || !!value.leaseId, {
    message: 'Cần phiên nhận hồ sơ hiện tại',
    path: ['leaseId'],
  });
export class ReviewAuditDto {
  @ApiProperty() id!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty({ enum: ['claim', 'renew', 'release', 'evidence_view'] }) action!: string;
  @ApiProperty({ type: String, nullable: true }) leaseId!: string | null;
  @ApiProperty() createdAt!: string;
}
export class ModerationAuthorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}
export class ModerationPostContextDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ type: ModerationAuthorDto, nullable: true }) author!: ModerationAuthorDto | null;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ type: String, nullable: true }) excerpt!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() visibility!: string;
  @ApiProperty() unavailable!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ModerationParentCommentDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ type: ModerationAuthorDto, nullable: true }) author!: ModerationAuthorDto | null;
  @ApiProperty({ type: String, nullable: true }) body!: string | null;
  @ApiProperty({ enum: ['reply', 'thread'] }) kind!: 'reply' | 'thread';
  @ApiProperty() status!: string;
  @ApiProperty() unavailable!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ModerationDetailDto extends ModerationCaseDto {
  @ApiProperty({ type: ModerationPostContextDto, nullable: true })
  postContext!: ModerationPostContextDto | null;
  @ApiProperty({ type: ModerationParentCommentDto, nullable: true })
  parentComment!: ModerationParentCommentDto | null;
  @ApiProperty({
    type: ModerationAuthorDto,
    nullable: true,
    description: 'Thông tin tài khoản tác giả, chỉ trả trong chi tiết dành cho staff.',
  })
  author!: ModerationAuthorDto | null;
  @ApiProperty({ type: () => [ReviewAuditDto] }) reviewAudit!: ReviewAuditDto[];
  @ApiProperty({ type: ModerationTargetDto, nullable: true }) target!: ModerationTargetDto | null;
  @ApiProperty({ type: [ModerationReportDto] }) reports!: ModerationReportDto[];
  @ApiProperty({ type: [ModerationLogDto] }) actions!: ModerationLogDto[];
}
export class ModerationLogPageDto {
  @ApiProperty({ type: [ModerationLogDto] }) items!: ModerationLogDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class ModerationDecisionResultDto {
  @ApiProperty() actionId!: string;
  @ApiProperty() changedCount!: number;
  @ApiProperty() previousStatus!: string;
  @ApiProperty() status!: string;
}

export class SubmitAppealDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) reason!: string;
}
export class AppealOutcomeDto {
  @ApiProperty({ enum: ['upheld', 'overturned'] }) outcome!: 'upheld' | 'overturned';
}
export class AppealDto {
  @ApiProperty() id!: string;
  @ApiProperty() decisionId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['pending', 'upheld', 'overturned'] }) status!: 'pending' | 'upheld' | 'overturned';
  @ApiProperty({ type: String, nullable: true }) reviewerId!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) resolvedAt!: string | null;
}
export class AppealPageDto {
  @ApiProperty({ type: [AppealDto] }) items!: AppealDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class AppealQueueItemDto {
  @ApiProperty({ type: AppealDto }) appeal!: AppealDto;
  @ApiProperty({ type: ModerationLogDto }) decision!: ModerationLogDto;
  @ApiProperty({ type: String, nullable: true }) targetText!: string | null;
  @ApiProperty({ type: String, nullable: true }) targetStatus!: string | null;
}
export class AppealQueuePageDto {
  @ApiProperty({ type: [AppealQueueItemDto] }) items!: AppealQueueItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class MyDecisionDto {
  @ApiProperty({ type: String, nullable: true }) targetPreview!: string | null;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['post', 'comment'] }) targetType!: 'post' | 'comment';
  @ApiProperty({ type: String, nullable: true }) postId!: string | null;
  @ApiProperty({ type: String, nullable: true }) commentId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, enum: ['pending', 'upheld', 'overturned'], nullable: true }) appealStatus!:
    string | null;
  @ApiProperty() canAppeal!: boolean;
}
export class MyDecisionPageDto {
  @ApiProperty({ type: [MyDecisionDto] }) items!: MyDecisionDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class MyReportDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['post', 'comment'] }) targetType!: 'post' | 'comment';
  @ApiProperty() targetId!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, enum: ['pending', 'resolved'], nullable: true }) caseStatus!: string | null;
}
export class MyReportPageDto {
  @ApiProperty({ type: [MyReportDto] }) items!: MyReportDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class FailedScanDto {
  @ApiProperty() eventId!: string;
  @ApiProperty() targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty() updatedAt!: string;
}
export class FailedScanPageDto {
  @ApiProperty({ type: [FailedScanDto] }) items!: FailedScanDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class ModerationStatsDto {
  @ApiProperty() unassigned!: number;
  @ApiProperty() assignedToMe!: number;
  @ApiProperty() overdue!: number;
  @ApiProperty() dueSoon!: number;
  @ApiProperty({ description: 'Hồ sơ chờ duyệt, cùng điều kiện với queue view=pending' })
  pendingTotal!: number;
  @ApiProperty({ description: 'Hồ sơ chờ duyệt có severity ≥ urgentSeverity' }) pendingUrgent!: number;
  @ApiProperty() pendingPosts!: number;
  @ApiProperty() pendingComments!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) oldestPendingAt!: string | null;
  @ApiProperty({ description: 'Số lần tự ẩn trong 24 giờ qua' }) autoHidden24h!: number;
  @ApiProperty({ description: 'Số báo cáo mới trong 24 giờ qua' }) reports24h!: number;
  @ApiProperty() pendingAppeals!: number;
  @ApiProperty({ description: 'Scan đã hết lượt thử, cần staff xem' }) failedScans!: number;
  @ApiProperty({ description: 'Scan đang chờ thử lại tự động' }) deferredScans!: number;
  @ApiProperty() urgentSeverity!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
}
export class ScanRetryDto {
  @ApiProperty() eventId!: string;
  @ApiProperty() status!: string;
}
