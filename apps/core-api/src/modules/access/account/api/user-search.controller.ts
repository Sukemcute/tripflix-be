import { Controller, Get, Header, Inject, Query, Req, UseFilters } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessErrorFilter, ZodBody, readRequestMeta } from '../../auth/api/http.js';
import { TOO_MANY_SEARCHES_MESSAGE, UserSearchUseCases } from '../application/user-search.use-cases.js';
import {
  PUBLIC_SEARCH_MAX_PAGE,
  PUBLIC_SEARCH_PAGE_SIZE,
  PUBLIC_SEARCH_QUERY_MAX,
  PUBLIC_SEARCH_QUERY_MIN,
  hasInvisibleCharacters,
  measureFoldedLength,
  normalizeSearchQuery,
} from '../domain/name-search.js';

export const UserSearchQuerySchema = z.object({
  q: z
    .string('Cần từ khoá')
    // Chặn chuỗi quá dài trước khi chuẩn hoá Unicode (NFKC có thể nở chuỗi).
    .max(PUBLIC_SEARCH_QUERY_MAX * 4, `Từ khoá tối đa ${PUBLIC_SEARCH_QUERY_MAX} ký tự`)
    .transform(normalizeSearchQuery)
    .pipe(
      z
        .string()
        .max(PUBLIC_SEARCH_QUERY_MAX, `Từ khoá tối đa ${PUBLIC_SEARCH_QUERY_MAX} ký tự`)
        .refine((q) => !hasInvisibleCharacters(q), 'Từ khoá có ký tự không hợp lệ')
        .refine((q) => measureFoldedLength(q) >= PUBLIC_SEARCH_QUERY_MIN, `Từ khoá tối thiểu ${PUBLIC_SEARCH_QUERY_MIN} chữ`),
    ),
  page: z.coerce
    .number('Số trang phải là số')
    .int('Số trang phải là số nguyên')
    .min(1, 'Số trang từ 1 trở lên')
    .max(PUBLIC_SEARCH_MAX_PAGE, `Chỉ xem được ${PUBLIC_SEARCH_MAX_PAGE} trang đầu, hãy gõ tên cụ thể hơn`)
    .default(1),
});

export class UserSearchItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Bảo Lê' }) displayName!: string;
}

export class UserSearchResponseDto {
  @ApiProperty({ type: UserSearchItemDto, isArray: true }) items!: UserSearchItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ description: `false ở trang ${PUBLIC_SEARCH_MAX_PAGE} dù còn người khớp` }) hasMore!: boolean;
}

/**
 * Tìm người dùng công khai cho ô tìm kiếm của app (không cần đăng nhập, không đọc hay đặt cookie).
 * Video của họ lấy qua GET /v1/posts?author_id=.
 */
@ApiTags('users')
@Controller('v1/users')
@UseFilters(AccessErrorFilter)
export class UserSearchController {
  constructor(@Inject(UserSearchUseCases) private readonly users: UserSearchUseCases) {}

  /**
   * Chỉ khớp tên hiển thị (không khớp email), bỏ qua dấu tiếng Việt. Chỉ hiện thành viên đang hoạt động, đã xác thực email,
   * từ 16 tuổi (chưa khai ngày sinh thì vẫn hiện); nhân viên, tài khoản khoá không hiện.
   * Giới hạn theo IP; quá giới hạn trả 429 kèm Retry-After.
   */
  @Get('search')
  // Danh sách tên người là dữ liệu cá nhân: không cho trình duyệt, proxy hay CDN lưu lại.
  @Header('Cache-Control', 'no-store')
  // Header cho API JSON theo OWASP REST Security Cheat Sheet; cấu hình chung (helmet) chưa có nên đặt riêng ở route này.
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  @Header('Referrer-Policy', 'no-referrer')
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: `${PUBLIC_SEARCH_QUERY_MIN}–${PUBLIC_SEARCH_QUERY_MAX} ký tự sau khi bỏ khoảng trắng thừa`,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: `1–${PUBLIC_SEARCH_MAX_PAGE}` })
  @ApiOkResponse({ type: UserSearchResponseDto, description: `${PUBLIC_SEARCH_PAGE_SIZE} người mỗi trang` })
  @ApiTooManyRequestsResponse({ description: TOO_MANY_SEARCHES_MESSAGE })
  search(@Query(new ZodBody(UserSearchQuerySchema)) query: z.infer<typeof UserSearchQuerySchema>, @Req() req: Request) {
    return this.users.searchPublic({ ...query, ip: readRequestMeta(req).ip });
  }
}
