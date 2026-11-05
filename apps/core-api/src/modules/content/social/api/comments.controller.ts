import { SocialErrorFilter } from './social-error.filter.js';
import {
  UseFilters,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { OptionalAuthenticated, OptionalCurrentUser } from './optional-auth.guard.js';
import {
  DeletedSocialItemDto,
  SocialCommentDto,
  SocialCommentPageDto,
  UpdatedCommentReactionDto,
} from './dto/response.dto.js';
import {
  CreateCommentDto,
  ListCommentsQueryDto,
  UpdateCommentDto,
} from './dto/comment.dto.js';
import { SetCommentReactionDto } from './dto/reaction.dto.js';
import {
  AddCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  ListCommentsUseCase,
  SetCommentReactionUseCase,
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
    private readonly setCommentReactionUseCase: SetCommentReactionUseCase,
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
    const comment = await this.addCommentUseCase.execute({
      postId,
      authorId: user.userId,
      body: dto.body,
      parentCommentId: dto.parent_comment_id,
    });
    return {
      ...comment,
      likeCount: 0,
      isLiked: false,
    };
  }

  @Get('posts/:postId/comments')
  @OptionalAuthenticated()
  @ApiOperation({ summary: 'Lấy danh sách bình luận của bài đăng (FR11)' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bình luận kèm phân trang cursor',
    type: SocialCommentPageDto,
  })
  async listComments(
    @Param('postId') postId: string,
    @Query() query: ListCommentsQueryDto,
    @OptionalCurrentUser() user?: AuthUser,
  ) {
    const isFlat = query.flat === true || (query.flat as unknown) === 'true';
    const isStaff = user?.role === 'superadmin' || user?.role === 'moderator';
    return this.listCommentsUseCase.execute({
      postId,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      parentCommentId: query.parent_comment_id,
      flat: isFlat,
      viewerId: user?.userId,
      isStaff,
    });
  }

  @Put('comments/:commentId/reaction')
  @ApiBearerAuth()
  @Authenticated()
  @ApiOperation({ summary: 'Thả tim hoặc hủy thả tim cho bình luận (FR11 - Idempotent)' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật trạng thái thả tim thành công',
    type: UpdatedCommentReactionDto,
  })
  async setCommentReaction(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: SetCommentReactionDto,
  ) {
    return this.setCommentReactionUseCase.execute({
      commentId,
      userId: user.userId,
      type: dto?.type,
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
    const comment = await this.editCommentUseCase.execute({
      commentId,
      userId: user.userId,
      body: dto.body,
    });
    return {
      ...comment,
      likeCount: comment.likeCount ?? 0,
      isLiked: false,
    };
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
