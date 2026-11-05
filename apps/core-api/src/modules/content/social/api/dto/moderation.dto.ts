import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ModerationActionType, PostStatus } from '../../../db/schema/index.js';

export class CreateModerationActionDto {
  @ApiProperty({ enum: ['hide', 'remove', 'restore'], example: 'hide', description: 'Hành động kiểm duyệt' })
  action!: ModerationActionType;

  @ApiProperty({ example: 'SPAM_OR_COMMERCIAL', description: 'Mã lý do' })
  reason_code!: string;

  @ApiPropertyOptional({ example: 'Spam đường link kéo sang nền tảng khác', description: 'Chi tiết lý do' })
  reason_detail?: string;

  @ApiPropertyOptional({ example: ['018d9f40-repo-7000-8000-000000000004'], type: [String], description: 'Danh sách ID báo cáo' })
  report_ids?: string[];
}

export class AdminPostQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bài' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'hidden', 'removed', 'deleted'], description: 'Lọc trạng thái' })
  status?: PostStatus;

  @ApiPropertyOptional({ description: 'Lọc theo tác giả' })
  author_id?: string;
}
