import { SocialErrorFilter } from './social-error.filter.js';
import { UseFilters, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { DeletedSocialItemDto, SocialCommentDto, SocialCommentPageDto } from './dto/response.dto.js';
import { CreateCommentDto, ListCommentsQueryDto, UpdateCommentDto } from './dto/comment.dto.js';
import {
  AddCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  ListCommentsUseCase,
} from '../application/index.js';

@ApiTags('Social - Comments')
@Controller('v1')
@UseFilters(SocialErrorFilter)
export class CommentsController {
  constructor(
    private readonly addCommentUseCase: AddCommentUseCase,
    private readonly editCommentUseCase: EditCommentUseCase,
    private readonly deleteCommentUseCase: DeleteCommentUseCase,
    private readonly listCommentsUseCase: ListCommentsUseCase,
  ) {}

  @Post('posts/:postId/comments')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Tạo bình luận mới trên bài đăng (FR11)' })
  @ApiResponse({ status: 201, description: 'Bình luận được tạo thành công', type: SocialCommentDto })
  async createComment(
    @Param('postId') postId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.addCommentUseCase.execute({
      postId,
      authorId: user.userId,
      body: dto.body,
      parentCommentId: dto.parent_comment_id,
    });
  }

  @Get('posts/:postId/comments')
  @ApiOperation({ summary: 'Lấy danh sách bình luận của bài đăng (FR11)' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bình luận kèm phân trang cursor',
    type: SocialCommentPageDto,
  })
  async listComments(@Param('postId') postId: string, @Query() query: ListCommentsQueryDto) {
    return this.listCommentsUseCase.execute({
      postId,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      parentCommentId: query.parent_comment_id,
    });
  }

  @Patch('comments/:commentId')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Chỉnh sửa bình luận của mình (FR11)' })
  @ApiResponse({ status: 200, description: 'Bình luận sau khi cập nhật', type: SocialCommentDto })
  async editComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.editCommentUseCase.execute({
      commentId,
      userId: user.userId,
      body: dto.body,
    });
  }

  @Delete('comments/:commentId')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Xóa bình luận của mình (FR11)' })
  @ApiResponse({ status: 200, description: 'Bình luận đã được xóa thành công', type: DeletedSocialItemDto })
  async deleteComment(@Param('commentId') commentId: string, @CurrentUser() user: AuthUser) {
    const isSuperAdmin = user.role === 'superadmin';
    return this.deleteCommentUseCase.execute({
      commentId,
      userId: user.userId,
      isSuperAdmin,
    });
  }
}
