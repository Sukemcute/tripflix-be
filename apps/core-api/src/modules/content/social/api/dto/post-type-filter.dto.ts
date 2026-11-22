import { BadRequestException } from '@nestjs/common';

/** Danh sách bài (bookmark, bài của tôi) chỉ lọc được vlog; Reels lấy qua /v1/feed. */
export const LIST_POST_TYPE_FILTERS = ['vlog'] as const;
export type ListPostTypeFilter = (typeof LIST_POST_TYPE_FILTERS)[number];

export function parseListPostTypeFilter(value: unknown): ListPostTypeFilter | undefined {
  if (value === undefined) return undefined;
  if (LIST_POST_TYPE_FILTERS.includes(value as ListPostTypeFilter)) return value as ListPostTypeFilter;
  throw new BadRequestException(`post_type chỉ nhận giá trị: ${LIST_POST_TYPE_FILTERS.join(', ')}`);
}
