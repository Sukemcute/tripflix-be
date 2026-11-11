import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { REASON_CODES } from '../domain/reason-codes.js';
export const ReportSchema = z.object({
  reasonCode: z.enum(REASON_CODES),
  reasonDetail: z.string().trim().max(500).optional(),
});
export const DecisionSchema = ReportSchema.extend({
  action: z.enum(['hide', 'restore', 'remove', 'dismiss']),
});
export class ReportDto {
  @ApiProperty({ enum: REASON_CODES }) reasonCode!: (typeof REASON_CODES)[number];
  @ApiPropertyOptional({ maxLength: 500 }) reasonDetail?: string;
}
export class DecisionDto extends ReportDto {
  @ApiProperty({ enum: ['hide', 'restore', 'remove', 'dismiss'] }) action!:
    'hide' | 'restore' | 'remove' | 'dismiss';
}
export const QueueQuerySchema = z.object({
  status: z.enum(['pending', 'resolved']).optional(),
  targetType: z.enum(['post', 'comment']).optional(),
  source: z.enum(['rule', 'ai', 'report', 'new_content']).optional(),
  reasonCode: z.enum(REASON_CODES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
});
export class QueueQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'resolved'] }) status?: 'pending' | 'resolved';
  @ApiPropertyOptional({ enum: ['post', 'comment'] }) targetType?: 'post' | 'comment';
  @ApiPropertyOptional({ enum: ['rule', 'ai', 'report', 'new_content'] }) source?: string;
  @ApiPropertyOptional({ enum: REASON_CODES }) reasonCode?: string;
  @ApiPropertyOptional({ default: 20 }) limit?: number;
  @ApiPropertyOptional({ description: 'Vị trí bắt đầu trang, lấy từ nextCursor' }) cursor?: string;
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
}
export class ModerationReportDto {
  @ApiProperty() id!: string;
  @ApiProperty() reporterId!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ type: String, nullable: true }) reasonDetail!: string | null;
  @ApiProperty() createdAt!: string;
}
export class ModerationDetailDto extends ModerationCaseDto {
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
