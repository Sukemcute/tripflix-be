import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const CoverOcrQuerySchema = z.object({
  status: z.enum(['all', 'flagged', 'failed', 'in_progress', 'passed']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
});
export type CoverOcrQuery = z.infer<typeof CoverOcrQuerySchema>;
export class CoverOcrQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'flagged', 'failed', 'in_progress', 'passed'] }) status?: string;
  @ApiPropertyOptional({ default: 20 }) limit?: number;
  @ApiPropertyOptional({ description: 'Vị trí trang kế tiếp' }) cursor?: number;
}
export class CoverOcrCountsDto {
  @ApiProperty() all!: number;
  @ApiProperty() flagged!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() inProgress!: number;
  @ApiProperty() passed!: number;
}
export class CoverOcrItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() postTitle!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty() assetId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ type: String, nullable: true }) extractedText!: string | null;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class CoverOcrPageDto {
  @ApiProperty({ type: CoverOcrCountsDto }) counts!: CoverOcrCountsDto;
  @ApiProperty({ type: [CoverOcrItemDto] }) items!: CoverOcrItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class ModerationPartDto {
  @ApiPropertyOptional({
    enum: ['caption', 'image', 'video_poster', 'video_frame', 'video_sampling', 'video_cover_ocr'],
  })
  modality?: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) timestampMs?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) sampleDurationMs?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) sampleCount?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) playbackUrl?: string | null;
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty({ enum: ['caption', 'image'] }) kind!: 'caption' | 'image';
  @ApiProperty({ type: String, nullable: true }) assetId!: string | null;
  @ApiProperty({ type: String, nullable: true, enum: ['image', 'video'] }) mediaKind!: string | null;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
  @ApiProperty({ type: String, nullable: true }) previewUrl!: string | null;
  @ApiProperty({
    enum: [
      'pending',
      'checking',
      'waiting',
      'deferred',
      'passed',
      'flagged',
      'failed',
      'not_applicable',
      'superseded',
    ],
  })
  status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } }) categories!: Record<
    string,
    boolean
  >;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) scores!: Record<string, number>;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedAt!: string | null;
}
export class ModerationPartsDto {
  @ApiProperty() contentVersion!: string;
  @ApiProperty({ enum: ['review_only'] }) imagePolicy!: 'review_only';
  @ApiProperty({ type: [ModerationPartDto] }) items!: ModerationPartDto[];
}
export class ModerationPartRetryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['pending'] }) status!: string;
}
