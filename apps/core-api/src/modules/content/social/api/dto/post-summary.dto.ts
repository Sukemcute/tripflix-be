import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SavePostSummaryDto {
  @ApiProperty({
    example: 'Bài viết chia sẻ trải nghiệm du lịch Ninh Bình với nhiều mẹo thực tế...',
    description: 'Nội dung tóm tắt tiếng Việt sinh từ AI',
  })
  summary!: string;

  @ApiPropertyOptional({
    example: ['Nên đi thuyền Tràng An lúc 7h sáng', 'Emeralda Resort có dịch vụ chu đáo'],
    description: 'Các điểm nổi bật đúc kết từ thảo luận cộng đồng',
    type: [String],
  })
  key_takeaways?: string[];

  @ApiPropertyOptional({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'Bản băm hash của tập bình luận đã dùng để tóm tắt',
  })
  input_hash?: string;

  @ApiPropertyOptional({
    example: 25,
    description: 'Số lượng bình luận tại thời điểm thực hiện tóm tắt',
  })
  comment_count?: number;
}
