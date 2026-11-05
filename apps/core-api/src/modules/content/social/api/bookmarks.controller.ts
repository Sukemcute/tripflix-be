import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator.js';
import { ListBookmarksQueryDto, SetBookmarkDto } from './dto/bookmark.dto.js';
import {
  BookmarkPostUseCase,
  ListBookmarksUseCase,
} from '../application/index.js';

@ApiTags('Social - Bookmarks')
@Controller('v1')
export class BookmarksController {
  constructor(
    private readonly bookmarkPostUseCase: BookmarkPostUseCase,
    private readonly listBookmarksUseCase: ListBookmarksUseCase,
  ) {}

  @Put('posts/:id/bookmark')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lưu hoặc bỏ lưu bài viết (PRD F3)' })
  @ApiResponse({ status: 200, description: 'Trạng thái lưu bài sau khi cập nhật' })
  async setBookmark(
    @Param('id') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetBookmarkDto,
  ) {
    return this.bookmarkPostUseCase.execute({
      postId,
      userId: user.id,
      isBookmarked: dto.is_bookmarked,
    });
  }

  @Get('me/bookmarks')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy danh sách bài viết đã lưu của tôi' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng đã bookmark' })
  async listMyBookmarks(
    @CurrentUser() user: RequestUser,
    @Query() query: ListBookmarksQueryDto,
  ) {
    return this.listBookmarksUseCase.execute({
      userId: user.id,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }
}
