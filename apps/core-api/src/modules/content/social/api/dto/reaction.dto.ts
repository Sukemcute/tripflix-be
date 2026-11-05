import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ReactionType } from '../../../db/schema/index.js';

export class SetReactionDto {
  @ApiProperty({
    enum: ['like', 'love', 'helpful', null],
    example: 'like',
    nullable: true,
    description: 'Loại cảm xúc hoặc null để hủy cảm xúc',
  })
  type!: ReactionType | null;
}

export class SetCommentReactionDto {
  @ApiPropertyOptional({
    enum: ['like', null],
    type: String,
    nullable: true,
    example: 'like',
    description: 'Loại cảm xúc ("like" để thích, null để hủy thích, để trống để toggle)',
  })
  type?: 'like' | null;
}
