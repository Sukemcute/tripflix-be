import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SampleCommentsQueryDto {
  @ApiPropertyOptional({
    default: 1000,
    minimum: 1,
    maximum: 5000,
    description: 'Số lượng mẫu ngẫu nhiên cần lấy (mặc định 1000, tối đa 5000)',
  })
  size?: number;

  @ApiPropertyOptional({
    description: 'Chuỗi seed phục vụ deterministic sampling (tái lập mẫu)',
    example: 'seed-20261111',
  })
  seed?: string;
}

export class CommentStatsDto {
  @ApiProperty({ example: 125000, description: 'Tổng số bình luận visible của bài viết' })
  visibleCommentCount!: number;

  @ApiProperty({ example: 48200, description: 'Tổng số tác giả khác nhau của các bình luận visible' })
  uniqueAuthorCount!: number;
}

export class SampleCommentItemDto {
  @ApiProperty({ example: 'c1-uuid' })
  id!: string;

  @ApiProperty({ example: 'p1-uuid' })
  postId!: string;

  @ApiProperty({ example: 'u1-uuid' })
  authorId!: string;

  @ApiProperty({ example: 'Trải nghiệm rất tuyệt vời!' })
  body!: string;

  @ApiProperty({ type: String, nullable: true, example: 'parent-uuid' })
  parentCommentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Bài viết chia sẻ rất chi tiết...' })
  parentCommentBody?: string | null;

  @ApiProperty({ example: 5, description: 'Số lượt thích bình luận' })
  likeCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Thời điểm chỉnh sửa bình luận (null nếu chưa từng sửa)',
  })
  editedAt!: Date | null;
}

export class SampleCommentsResponseDto {
  @ApiProperty({ type: CommentStatsDto })
  stats!: CommentStatsDto;

  @ApiProperty({ type: [SampleCommentItemDto] })
  items!: SampleCommentItemDto[];
}

export class PostCommentStatsResponseDto {
  @ApiProperty({ example: 'p1-uuid' })
  postId!: string;

  @ApiProperty({ example: 125000, description: 'Tổng số bình luận visible' })
  visibleCommentCount!: number;

  @ApiProperty({ example: 48200, description: 'Tổng số tác giả khác nhau của các bình luận visible' })
  uniqueAuthorCount!: number;
}

export class ReconcileHeldSummariesQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 200, description: 'Số lượng bài viết cần lấy' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor phân trang keyset theo postId' })
  cursor?: string;
}

export class ReconcileHeldSummariesResponseDto {
  @ApiProperty({ type: [String], description: 'Danh sách postId có tóm tắt đang bị giữ lại cần tóm tắt bù' })
  postIds!: string[];

  @ApiProperty({ type: String, nullable: true, description: 'Cursor cho trang tiếp theo (null nếu hết)' })
  nextCursor!: string | null;

  @ApiProperty({ example: 12, description: 'Tổng số bài viết trong trang hiện tại' })
  total!: number;
}
