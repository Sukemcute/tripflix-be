import { Controller, Get, Inject, Query, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessErrorFilter, ZodBody } from '../../auth/api/http.js';
import { USER_SEARCH_PAGE_SIZE, UserSearchUseCases } from '../application/user-search.use-cases.js';

export const UserSearchQuerySchema = z.object({
  q: z.string('Cần từ khoá').trim().min(1, 'Cần từ khoá').max(50, 'Từ khoá tối đa 50 ký tự'),
  page: z.coerce
    .number('Số trang phải là số')
    .int('Số trang phải là số nguyên')
    .min(1, 'Số trang từ 1 trở lên')
    .max(1000, 'Số trang tối đa 1000')
    .default(1),
});

export class UserSearchItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Bảo Lê' }) displayName!: string;
}

export class UserSearchResponseDto {
  @ApiProperty({ type: UserSearchItemDto, isArray: true }) items!: UserSearchItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() hasMore!: boolean;
}

/** Tìm người dùng công khai cho ô tìm kiếm của app (không cần đăng nhập). Video của họ lấy qua GET /v1/posts?author_id=. */
@ApiTags('users')
@Controller('v1/users')
@UseFilters(AccessErrorFilter)
export class UserSearchController {
  constructor(@Inject(UserSearchUseCases) private readonly users: UserSearchUseCases) {}

  /** Chỉ khớp tên hiển thị (không khớp email), bỏ qua dấu tiếng Việt; tài khoản bị khoá không hiện. */
  @Get('search')
  @ApiQuery({ name: 'q', required: true, type: String, description: '1–50 ký tự' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiOkResponse({ type: UserSearchResponseDto, description: `${USER_SEARCH_PAGE_SIZE} người mỗi trang` })
  search(@Query(new ZodBody(UserSearchQuerySchema)) query: z.infer<typeof UserSearchQuerySchema>) {
    return this.users.searchPublic(query);
  }
}
