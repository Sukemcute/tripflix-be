import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetBookmarkDto {
  @ApiProperty({ example: true, description: 'true: lưu bài, false: bỏ lưu bài' })
  is_bookmarked!: boolean;
}

export class ListBookmarksQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bài lấy mỗi trang' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;
}
