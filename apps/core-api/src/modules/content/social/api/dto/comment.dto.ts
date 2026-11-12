import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    example: 'Bài viết chia sẻ rất chi tiết!',
    description: 'Nội dung bình luận (tối đa 2.000 ký tự)',
    maxLength: 2000,
  })
  body!: string;

  @ApiPropertyOptional({ example: '018d9f30-comm-7000-8000-000000000001', description: 'ID bình luận cha nếu là phản hồi' })
  parent_comment_id?: string;
}

export class UpdateCommentDto {
  @ApiProperty({
    example: 'Nội dung bình luận đã chỉnh sửa...',
    description: 'Nội dung mới (tối đa 2.000 ký tự)',
    maxLength: 2000,
  })
  body!: string;
}

export class ListCommentsQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bình luận (mặc định tối đa 50, chế độ phẳng tối đa 200)' })
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Chỉ lấy bình luận chỉ định và bình luận cha nếu có' })
  focusCommentId?: string;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'ID bình luận cha nếu muốn xem phản hồi con' })
  parent_comment_id?: string;

  @ApiPropertyOptional({ default: false, description: 'Chế độ trả phẳng toàn bộ bình luận và phản hồi mọi cấp (dành cho AI / Indexing)' })
  flat?: boolean;
}
