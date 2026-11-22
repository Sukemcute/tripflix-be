import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LIST_POST_TYPE_FILTERS, type ListPostTypeFilter } from './post-type-filter.dto.js';

export class SetBookmarkDto {
  @ApiProperty({ example: true, description: 'true: lưu bài, false: bỏ lưu bài' })
  is_bookmarked!: boolean;
}

export class ListBookmarksQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bài lấy mỗi trang' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;

  @ApiPropertyOptional({
    enum: LIST_POST_TYPE_FILTERS,
    description: 'Lọc theo loại bài. Không truyền thì trả mọi loại. Reels đã lưu lấy qua /v1/feed?saved=true',
  })
  post_type?: ListPostTypeFilter;
}
