import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { CommentMentionSchema } from '../../domain/index.js';

export class CommentMentionDto {
  @ApiProperty({ format: 'uuid', description: 'ID người dùng được tag, không dùng username' })
  userId!: string;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Vị trí @ trong body, tính theo UTF-16' })
  offset!: number;

  @ApiProperty({ type: 'integer', minimum: 2, description: 'Độ dài UTF-16, bao gồm @ và tên hiển thị' })
  length!: number;
}

export const CreateCommentRequestSchema = z.object({
  body: z.string(),
  parent_comment_id: z.string().nullish().transform((value) => value ?? undefined),
  mentions: z.array(CommentMentionSchema).max(10).optional(),
});
export const UpdateCommentRequestSchema = CreateCommentRequestSchema.omit({ parent_comment_id: true });

export class CreateCommentDto {
  @ApiProperty({
    example: 'Bài viết chia sẻ rất chi tiết!',
    description: 'Nội dung bình luận (tối đa 2.000 ký tự)',
    maxLength: 2000,
  })
  body!: string;

  @ApiPropertyOptional({ type: [CommentMentionDto], maxItems: 10, description: 'Tag trong body gửi lên; mặc định []' })
  mentions?: CommentMentionDto[];

  @ApiPropertyOptional({ example: '018d9f30-comm-7000-8000-000000000001', description: 'ID bình luận cha nếu là phản hồi' })
  parent_comment_id?: string;
}

export class UpdateCommentDto {
  @ApiPropertyOptional({ type: [CommentMentionDto], maxItems: 10, description: 'Bỏ qua để giữ và kiểm lại tag cũ; [] để xóa tag' })
  mentions?: CommentMentionDto[];
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
