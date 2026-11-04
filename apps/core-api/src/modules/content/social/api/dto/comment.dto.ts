import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'Bài viết chia sẻ rất chi tiết!', description: 'Nội dung bình luận' })
  body!: string;

  @ApiPropertyOptional({ example: '018d9f30-comm-7000-8000-000000000001', description: 'ID bình luận cha nếu là phản hồi' })
  parent_comment_id?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ example: 'Nội dung bình luận đã chỉnh sửa...', description: 'Nội dung mới' })
  body!: string;
}

export class ListCommentsQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bình luận' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'ID bình luận cha nếu muốn xem phản hồi con' })
  parent_comment_id?: string;
}
