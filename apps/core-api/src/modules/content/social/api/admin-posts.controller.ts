import { SocialErrorFilter } from './social-error.filter.js';
import {
  UseFilters,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import { AdminPostQueryDto, CreateModerationActionDto } from './dto/moderation.dto.js';
import {
  AdminSocialPostDetailDto,
  AdminSocialPostPageDto,
  SocialModerationResultDto,
} from './dto/response.dto.js';
import { PostNotFoundException } from '../domain/errors.js';
import {
  AdminModeratePostUseCase,
  GetAdminPostDetailUseCase,
  ListAdminPostsUseCase,
} from '../application/index.js';

@ApiTags('Social - Admin Moderation')
@ApiBearerAuth()
@Controller('v1')
@UseFilters(SocialErrorFilter)
@Roles('moderator', 'superadmin')
export class AdminPostsController {
  constructor(
    private readonly listAdminPostsUseCase: ListAdminPostsUseCase,
    private readonly getAdminPostDetailUseCase: GetAdminPostDetailUseCase,
    private readonly adminModeratePostUseCase: AdminModeratePostUseCase,
  ) {}

  @Get('admin/posts')
  @ApiOperation({ summary: 'Danh sách bài đăng trong trang quản trị (FR13)' })
  @ApiResponse({ status: 200, description: 'Danh sách bài đăng và tổng số', type: AdminSocialPostPageDto })
  async listAdminPosts(@CurrentUser() user: AuthUser, @Query() query: AdminPostQueryDto) {
    this.assertModerator(user);
    return this.listAdminPostsUseCase.execute({
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      status: query.status,
      authorId: query.author_id,
    });
  }

  @Get('admin/posts/:id')
  @ApiOperation({ summary: 'Chi tiết bài đăng kèm lịch sử kiểm duyệt (FR13)' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết bài đăng và lịch sử kiểm duyệt',
    type: AdminSocialPostDetailDto,
  })
  async getAdminPostDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertModerator(user);
    try {
      return await this.getAdminPostDetailUseCase.execute({ postId: id });
    } catch (err) {
      if (err instanceof PostNotFoundException) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  @Post('admin/posts/:id/moderation-actions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Xử lý kiểm duyệt bài viết (FR13)' })
  @ApiResponse({
    status: 201,
    description: 'Ghi nhận hành động kiểm duyệt thành công',
    type: SocialModerationResultDto,
  })
  async moderatePost(
    @CurrentUser() user: AuthUser,
    @Param('id') postId: string,
    @Body() dto: CreateModerationActionDto,
  ) {
    this.assertModerator(user);
    return this.adminModeratePostUseCase.execute({
      postId,
      moderatorId: user.userId,
      action: dto.action,
      reasonCode: dto.reason_code,
      reasonDetail: dto.reason_detail,
      reportIds: dto.report_ids,
    });
  }

  private assertModerator(user: AuthUser): void {
    const role = user.role?.toLowerCase();
    if (!role || !['moderator', 'superadmin', 'admin'].includes(role)) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác quản trị');
    }
  }
}
