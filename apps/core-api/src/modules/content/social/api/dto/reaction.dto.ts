import { ApiProperty } from '@nestjs/swagger';
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
