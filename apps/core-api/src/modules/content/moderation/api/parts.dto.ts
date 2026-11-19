import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModerationPartDto {
  @ApiPropertyOptional({ enum: ['caption', 'image', 'video_poster', 'video_frame', 'video_sampling'] })
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
