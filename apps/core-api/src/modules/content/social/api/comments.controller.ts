import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator.js';
import {
  CreateCommentDto,
  ListCommentsQueryDto,
  UpdateCommentDto,
} from './dto/comment.dto.js';
import {
  AddCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  ListCommentsUseCase,
} from '../application/index.js';

@ApiTags('Social - Comments')
@Controller('v1')
export class CommentsController {
  constructor(
    private readonly addCommentUseCase: AddCommentUseCase,
    private readonly editCommentUseCase: EditCommentUseCase,
    private readonly deleteCommentUseCase: DeleteCommentUseCase,
    private readonly listCommentsUseCase: ListCommentsUseCase,
  ) {}

  @Post('posts/:postId/comments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo bình luận mới trên bài đăng (FR11)' })
  @ApiResponse({ status: 201, description: 'Bình luận được tạo thành công' })
  async createComment(
    @Param('postId') postId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.addCommentUseCase.execute({
      postId,
      authorId: user.id,
      body: dto.body,
      parentCommentId: dto.parent_comment_id,
    });
  }

  @Get('posts/:postId/comments')
  @ApiOperation({ summary: 'Lấy danh sách bình luận của bài đăng (FR11)' })
  @ApiResponse({ status: 200, description: 'Danh sách bình luận kèm phân trang cursor' })
  async listComments(
    @Param('postId') postId: string,
    @Query() query: ListCommentsQueryDto,
  ) {
    return this.listCommentsUseCase.execute({
      postId,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      parentCommentId: query.parent_comment_id,
    });
  }

  @Patch('comments/:commentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chỉnh sửa bình luận của mình (FR11)' })
  @ApiResponse({ status: 200, description: 'Bình luận sau khi cập nhật' })
  async editComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.editCommentUseCase.execute({
      commentId,
      userId: user.id,
      body: dto.body,
    });
  }

  @Delete('comments/:commentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xóa bình luận của mình (FR11)' })
  @ApiResponse({ status: 200, description: 'Bình luận đã được xóa thành công' })
  async deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const isSuperAdmin = user.role === 'superadmin';
    return this.deleteCommentUseCase.execute({
      commentId,
      userId: user.id,
      isSuperAdmin,
    });
  }
}
