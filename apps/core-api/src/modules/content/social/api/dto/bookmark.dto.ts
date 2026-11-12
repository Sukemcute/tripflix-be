import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const BOOKMARK_POST_TYPES = ['vlog'] as const;
export type BookmarkPostType = (typeof BOOKMARK_POST_TYPES)[number];

export function isBookmarkPostType(value: unknown): value is BookmarkPostType {
  return BOOKMARK_POST_TYPES.includes(value as BookmarkPostType);
}

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
    enum: BOOKMARK_POST_TYPES,
    description: 'Lọc theo loại bài. Không truyền thì trả mọi loại. Reels đã lưu lấy qua /v1/feed',
  })
  post_type?: BookmarkPostType;
}
