import { SocialErrorFilter } from './social-error.filter.js';
import { UseFilters, Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { ListBookmarksQueryDto, SetBookmarkDto } from './dto/bookmark.dto.js';
import { SocialPostPageDto, UpdatedBookmarkDto } from './dto/response.dto.js';
import { BookmarkPostUseCase, ListBookmarksUseCase } from '../application/index.js';

@ApiTags('Social - Bookmarks')
@ApiBearerAuth()
@Authenticated()
@Controller('v1')
@UseFilters(SocialErrorFilter)
export class BookmarksController {
  constructor(
    private readonly bookmarkPostUseCase: BookmarkPostUseCase,
    private readonly listBookmarksUseCase: ListBookmarksUseCase,
  ) {}

  @Put('posts/:id/bookmark')
  @ApiOperation({ summary: 'Lưu hoặc bỏ lưu bài viết (PRD F3)' })
  @ApiResponse({ status: 200, description: 'Trạng thái lưu bài sau khi cập nhật', type: UpdatedBookmarkDto })
  async setBookmark(@Param('id') postId: string, @CurrentUser() user: AuthUser, @Body() dto: SetBookmarkDto) {
    return this.bookmarkPostUseCase.execute({
      postId,
      userId: user.userId,
      isBookmarked: dto.is_bookmarked,
    });
  }

  @Get('me/bookmarks')
  @ApiOperation({ summary: 'Lấy danh sách bài viết đã lưu của tôi' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng đã bookmark', type: SocialPostPageDto })
  async listMyBookmarks(@CurrentUser() user: AuthUser, @Query() query: ListBookmarksQueryDto) {
    return this.listBookmarksUseCase.execute({
      userId: user.userId,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }
}
